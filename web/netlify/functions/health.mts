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
import { FILE_IDS as COMMITTED_FILE_IDS } from "./file-ids.js";

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

  // File ids ship committed, so the env var is an optional override. Report
  // which source is in effect and validate an override if one is present.
  let fileIdsParsed: { valid: boolean; count: number; source: string; note?: string };
  if (fileIds.present) {
    try {
      const parsed = JSON.parse(process.env.FILE_IDS as string);
      const values = Object.values(parsed);
      fileIdsParsed = {
        valid: values.length > 0,
        count: values.length,
        source: "FILE_IDS environment variable (override)",
        note: values.every((v) => typeof v === "string" && v.startsWith("file_"))
          ? "all values look like file ids"
          : "WARNING: some values do not start with 'file_'",
      };
    } catch {
      fileIdsParsed = {
        valid: false,
        count: 0,
        source: "FILE_IDS environment variable (override) — INVALID",
        note: "not valid JSON. Remove the variable to fall back to the committed ids.",
      };
    }
  } else {
    fileIdsParsed = {
      valid: Object.keys(COMMITTED_FILE_IDS).length > 0,
      count: Object.keys(COMMITTED_FILE_IDS).length,
      source: "committed in file-ids.ts (no configuration needed)",
    };
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
        FILE_IDS: {
          ...fileIds,
          ...fileIdsParsed,
          required: false,
          note: "optional — ids are committed in file-ids.ts; set this only to override them",
        },
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
        : "Set an Anthropic API key. File ids no longer need configuring — they are committed. If a variable shows present:false but exists in the Netlify UI, its scope probably excludes Functions, or it is set for a different deploy context. Env changes only reach functions after a new deploy.",
    },
    { headers: { "cache-control": "no-store" } },
  );
};

export const config: Config = {
  path: "/api/health",
};
