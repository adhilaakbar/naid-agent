/**
 * Config diagnostic. Reports whether the function can actually read each
 * expected environment variable — never their values.
 *
 * The most common Netlify misconfiguration is a variable that exists in the UI
 * but is scoped to Builds only, or set for the wrong deploy context. In both
 * cases the dashboard looks correct while process.env is empty at runtime, so
 * checking from inside the function is the only reliable signal.
 *
 *   curl https://<site>.netlify.app/api/health
 */
import type { Config } from "@netlify/functions";

function describe(name: string) {
  const v = process.env[name];
  return {
    present: typeof v === "string" && v.length > 0,
    length: v ? v.length : 0,
  };
}

/**
 * Shape checks on the API key. Reports only structural facts — prefix, stray
 * whitespace, repetition — never the key itself. A key that is present but the
 * wrong length is almost always a bad paste, and these narrow down which kind.
 */
function inspectKey(name: string) {
  const v = process.env[name] ?? "";
  const trimmed = v.trim();
  const occurrences = (v.match(/sk-ant-/g) ?? []).length;
  const problems: string[] = [];

  if (!v) return { problems: ["not set"], occurrences: 0 };
  if (!trimmed.startsWith("sk-ant-"))
    problems.push("does not start with 'sk-ant-' — wrong value pasted");
  if (v !== trimmed) problems.push("has leading/trailing whitespace — trim it");
  if (/[\r\n]/.test(v)) problems.push("contains a line break — paste as one line");
  if (occurrences > 1)
    problems.push(`contains 'sk-ant-' ${occurrences} times — the key was pasted more than once`);
  if (v.includes("ANTHROPIC_API_KEY"))
    problems.push("contains the variable name — paste only the value, not NAME=value");
  if (v.includes("file_"))
    problems.push("contains 'file_' — FILE_IDS content was pasted into this field");
  if (trimmed.startsWith("eyJ"))
    problems.push(
      "looks like a JWT, not an Anthropic key — this is Netlify's AI Gateway token, " +
        "not yours. Set your key as NAID_ANTHROPIC_API_KEY instead.",
    );
  if (trimmed.length < 90 || trimmed.length > 130)
    problems.push(`length ${trimmed.length} is outside the expected ~100-115 range`);

  return { problems: problems.length ? problems : ["looks well-formed"], occurrences };
}

export default async () => {
  const ownKey = describe("NAID_ANTHROPIC_API_KEY");
  const sharedKey = describe("ANTHROPIC_API_KEY");
  const fileIds = describe("FILE_IDS");
  const password = describe("SITE_PASSWORD");

  // Mirrors resolveApiKey() in chat.mts.
  const usable =
    (process.env.NAID_ANTHROPIC_API_KEY?.trim()?.length ?? 0) > 0 ||
    (process.env.ANTHROPIC_API_KEY?.trim()?.startsWith("sk-ant-") ?? false);

  // Validate FILE_IDS shape without echoing any ids.
  let fileIdsParsed: { valid: boolean; count: number; note?: string } = {
    valid: false,
    count: 0,
  };
  if (fileIds.present) {
    try {
      const parsed = JSON.parse(process.env.FILE_IDS as string);
      const values = Object.values(parsed);
      fileIdsParsed = {
        valid: true,
        count: values.length,
        note: values.every((v) => typeof v === "string" && v.startsWith("file_"))
          ? "all values look like file ids"
          : "WARNING: some values do not start with 'file_'",
      };
    } catch {
      fileIdsParsed = {
        valid: false,
        count: 0,
        note: "FILE_IDS is set but is not valid JSON — check for smart quotes or a truncated paste",
      };
    }
  }

  const ready = usable && fileIdsParsed.valid && fileIdsParsed.count > 0;

  return Response.json(
    {
      ready,
      apiKeyResolved: usable
        ? ownKey.present
          ? "using NAID_ANTHROPIC_API_KEY"
          : "using ANTHROPIC_API_KEY"
        : "NO USABLE KEY — set NAID_ANTHROPIC_API_KEY",
      checks: {
        NAID_ANTHROPIC_API_KEY: {
          ...ownKey,
          preferred: true,
          diagnosis: ownKey.present
            ? inspectKey("NAID_ANTHROPIC_API_KEY").problems
            : ["not set — set your sk-ant- key here"],
        },
        ANTHROPIC_API_KEY: {
          ...sharedKey,
          note: "Netlify's AI Gateway may claim this name; it is only used as a fallback",
          diagnosis: inspectKey("ANTHROPIC_API_KEY").problems,
        },
        FILE_IDS: { ...fileIds, ...fileIdsParsed, expected: "JSON object, 14 entries" },
        SITE_PASSWORD: {
          ...password,
          note: password.present
            ? "gate is ACTIVE"
            : "gate is OFF — anyone with the URL can spend your API credits",
        },
        NAID_EFFORT: {
          value: process.env.NAID_EFFORT ?? "(unset, defaults to medium)",
        },
      },
      hint: ready
        ? "Config looks good."
        : "Set NAID_ANTHROPIC_API_KEY (your sk-ant- key) and FILE_IDS. If a variable shows present:false but exists in the Netlify UI, its scope probably excludes Functions, or it is set for a different deploy context. Env changes only reach functions after a new deploy — trigger one after editing.",
    },
    { headers: { "cache-control": "no-store" } },
  );
};

export const config: Config = {
  path: "/api/health",
};
