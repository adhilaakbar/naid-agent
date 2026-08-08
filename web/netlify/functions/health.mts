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

export default async () => {
  const key = describe("ANTHROPIC_API_KEY");
  const fileIds = describe("FILE_IDS");
  const password = describe("SITE_PASSWORD");

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

  const ready = key.present && fileIdsParsed.valid && fileIdsParsed.count > 0;

  return Response.json(
    {
      ready,
      checks: {
        ANTHROPIC_API_KEY: {
          ...key,
          expected: "~108 chars, starts with sk-ant-",
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
        : "If a variable shows present:false but exists in the Netlify UI, its scope probably excludes Functions, or it is set for a different deploy context. Fix the scope, then redeploy — env changes need a new deploy to reach functions.",
    },
    { headers: { "cache-control": "no-store" } },
  );
};

export const config: Config = {
  path: "/api/health",
};
