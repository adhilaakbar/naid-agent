/**
 * NAID Agent — streaming chat endpoint.
 *
 * TypeScript port of agent/core.py. The agent has no local tools: all work
 * happens in Anthropic's code-execution container (pandas over the parquet
 * files, already uploaded to the Files API) plus web search. So this function
 * is purely an orchestration loop over the Messages API.
 *
 * Two things differ from the Streamlit version, both forced by serverless:
 *
 *   1. State. NAIDAgent kept messages/container_id on the instance because
 *      Streamlit holds one process per session. Every function invocation here
 *      is a cold process, so conversation state lives in Netlify Blobs keyed by
 *      session id. The browser only ever holds that id.
 *
 *   2. Generated images. core.py diffed a full account-wide files.list() against
 *      a set primed at startup. That priming can't survive a cold start, and it
 *      would re-list every file on every request. The newer code-execution tool
 *      returns generated file ids directly on the result block, so we read them
 *      from there instead — no listing, no diffing.
 *
 * Wire format is newline-delimited JSON so the browser can parse incrementally.
 */
import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { FILE_IDS } from "./file-ids.js";

const MODEL = "claude-opus-5";

// Thinking is on by default on Opus 5 and max_tokens caps thinking + text
// together, so this is well above core.py's 4000 — that budget would truncate
// mid-answer here.
const MAX_TOKENS = 16000;

// Netlify caps streaming functions at 60s with no way to raise it. We stop
// starting new model rounds once we're close and hand back what we have, so a
// long turn degrades into a partial answer rather than a dropped connection.
const WALL_CLOCK_BUDGET_MS = 52_000;

// Effort trades answer depth against latency, and latency is the binding
// constraint at 60s. Opus 5 is unusually strong at medium; override per-deploy
// via env if briefing depth matters more than speed.
const EFFORT = (process.env.NAID_EFFORT ?? "medium") as
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

const CODE_PHRASES = [
  "Querying the data",
  "Loading the parquet",
  "Computing aggregates",
  "Slicing by state and sector",
  "Cross-checking the numbers",
  "Refining the analysis",
  "Building the chart",
];
const WEB_PHRASES = [
  "Checking recent coverage",
  "Searching for policy updates",
  "Looking up current figures",
  "Pulling the latest reporting",
];
const PROCESSING_PHRASES = [
  "Reading the results",
  "Synthesizing what came back",
  "Drafting the answer",
  "Pulling it together",
  "Citing the sources",
];

type SessionState = {
  messages: Anthropic.Beta.BetaMessageParam[];
  containerId: string | null;
};

/**
 * Parquet + methodology file ids. These ship committed in file-ids.ts, so no
 * configuration is required. Set the FILE_IDS environment variable only to
 * point at a different set of uploads without redeploying code.
 */
function loadFileIds(): Record<string, string> {
  const raw = process.env.FILE_IDS?.trim();
  if (!raw) return FILE_IDS;

  try {
    const parsed = JSON.parse(raw);
    const count = Object.keys(parsed).length;
    if (count === 0) return FILE_IDS;
    return parsed;
  } catch {
    throw new Error(
      "FILE_IDS is set but is not valid JSON. Remove the variable to use the " +
        "ids committed in file-ids.ts, or fix the JSON.",
    );
  }
}

/**
 * Netlify's own AI Gateway injects an ANTHROPIC_API_KEY (a gateway JWT, not an
 * sk-ant- key) when the Claude Agent feature is enabled on the site. That value
 * silently shadows anything you set under the same name, so read a project
 * specific name first and only fall back to the shared one.
 */
function resolveApiKey(): string {
  const own = process.env.NAID_ANTHROPIC_API_KEY?.trim();
  if (own) return own;

  const shared = process.env.ANTHROPIC_API_KEY?.trim();
  if (shared?.startsWith("sk-ant-")) return shared;

  if (shared) {
    throw new Error(
      "ANTHROPIC_API_KEY is set but is not an Anthropic API key (it does not " +
        "start with 'sk-ant-'). Netlify's AI Gateway claims that variable name. " +
        "Set your key as NAID_ANTHROPIC_API_KEY instead. See /api/health.",
    );
  }
  throw new Error(
    "No Anthropic API key found. Set NAID_ANTHROPIC_API_KEY in Netlify. See /api/health.",
  );
}

// Built lazily so a misconfigured key surfaces as a readable message on the
// stream rather than crashing module load with an opaque 500.
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: resolveApiKey() });
  return _client;
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: { message?: string; sessionId?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  // Optional shared-password gate. Without it, anyone who finds the URL spends
  // your Anthropic credits. Only enforced when SITE_PASSWORD is set.
  const gate = process.env.SITE_PASSWORD;
  if (gate && body.password !== gate) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const userMessage = (body.message ?? "").trim();
  if (!userMessage) {
    return new Response("Empty message", { status: 400 });
  }

  const sessionId = body.sessionId || crypto.randomUUID();
  const started = Date.now();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      try {
        send({ t: "session", sessionId });

        const store = getStore("naid-sessions");
        const state: SessionState =
          (await store.get(sessionId, { type: "json" })) ?? {
            messages: [],
            containerId: null,
          };

        const isFirstTurn = state.messages.length === 0;

        // First turn attaches every file to the container and sets a cache
        // breakpoint, so later turns cache-read the upload list instead of
        // re-sending it as fresh input.
        if (isFirstTurn) {
          const fileIds = loadFileIds();
          const content: Anthropic.Beta.BetaContentBlockParam[] = Object.values(
            fileIds,
          ).map((fileId) => ({
            type: "container_upload" as const,
            file_id: fileId,
          }));
          content.push({
            type: "text",
            text: userMessage,
            cache_control: { type: "ephemeral" },
          });
          state.messages.push({ role: "user", content });
        } else {
          state.messages.push({ role: "user", content: userMessage });
        }

        const generatedFileIds: string[] = [];
        let codeIdx = 0;
        let webIdx = 0;
        let procIdx = 0;
        let truncated = false;

        // Agent loop: keep going until the model stops calling tools.
        for (;;) {
          if (Date.now() - started > WALL_CLOCK_BUDGET_MS) {
            truncated = true;
            break;
          }

          const modelStream = getClient().beta.messages.stream({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            betas: ["files-api-2025-04-14"],
            output_config: { effort: EFFORT },
            system: [
              {
                type: "text",
                text: SYSTEM_PROMPT,
                cache_control: { type: "ephemeral" },
              },
            ],
            tools: [
              { type: "code_execution_20260521", name: "code_execution" },
              // Deliberately the basic web-search variant: the _20260209 version
              // runs code execution under the hood for dynamic filtering, and a
              // second execution environment alongside our own code_execution
              // tool confuses the model.
              {
                type: "web_search_20250305",
                name: "web_search",
                max_uses: 2,
                cache_control: { type: "ephemeral" },
              },
            ],
            messages: state.messages,
            ...(state.containerId ? { container: state.containerId } : {}),
          });

          let currentTool: string | null = null;
          let currentToolInput = "";

          for await (const event of modelStream) {
            if (event.type === "content_block_start") {
              const block = event.content_block;
              if (block.type === "server_tool_use") {
                // The code-execution tool reports itself as "bash_code_execution",
                // not "code_execution" — match on substring so both spellings work.
                currentTool = block.name;
                currentToolInput = "";
                if (currentTool.includes("code_execution")) {
                  send({
                    t: "status",
                    v: CODE_PHRASES[codeIdx++ % CODE_PHRASES.length],
                  });
                } else if (currentTool.includes("web_search")) {
                  send({
                    t: "status",
                    v: WEB_PHRASES[webIdx++ % WEB_PHRASES.length],
                  });
                }
              }
            } else if (event.type === "content_block_delta") {
              const delta = event.delta;
              if (delta.type === "text_delta") {
                send({ t: "text", v: delta.text });
              } else if (delta.type === "input_json_delta" && currentTool) {
                currentToolInput += delta.partial_json ?? "";
              }
            } else if (event.type === "content_block_stop") {
              // Surface a snippet of what the model is actually doing.
              if (currentTool && currentToolInput) {
                try {
                  const parsed = JSON.parse(currentToolInput);
                  if (currentTool.includes("web_search") && parsed.query) {
                    send({ t: "detail", v: String(parsed.query).slice(0, 120) });
                  } else if (currentTool.includes("code_execution")) {
                    // This tool version sends `command`; older ones sent `code`.
                    const code: string = parsed.command ?? parsed.code ?? "";
                    const firstLine = code
                      .split("\n")
                      .map((l: string) => l.trim())
                      .find((l: string) => l && !l.startsWith("#"));
                    if (firstLine) {
                      send({ t: "code", v: firstLine.slice(0, 100) });
                    }
                  }
                } catch {
                  // Partial JSON on an interrupted block — nothing to show.
                }
              }
              currentTool = null;
              currentToolInput = "";
            }
          }

          const response = await modelStream.finalMessage();

          if (!state.containerId && response.container) {
            state.containerId = response.container.id;
          }

          state.messages.push({ role: "assistant", content: response.content });

          for (const block of response.content) {
            if (block.type === "bash_code_execution_tool_result") {
              const result: any = block.content;
              if (result?.type === "bash_code_execution_result") {
                for (const item of result.content ?? []) {
                  // Files the container wrote (charts, decks) come back as
                  // file ids on the result block — no account-wide listing.
                  if (item.type === "bash_code_execution_output" && item.file_id) {
                    generatedFileIds.push(item.file_id);
                  }
                }
              }
            }
          }

          if (response.stop_reason === "tool_use") {
            send({
              t: "status",
              v: PROCESSING_PHRASES[procIdx++ % PROCESSING_PHRASES.length],
            });
            continue;
          }

          if (response.stop_reason === "refusal") {
            send({
              t: "error",
              v: "The request was declined by Anthropic's safety classifiers. Try rephrasing.",
            });
          }
          break;
        }

        // Download only images, and only the last one — the system prompt asks
        // for exactly one chart per request, so extras are regeneration attempts.
        const imageIds = [];
        for (const fileId of generatedFileIds) {
          try {
            const meta = await getClient().beta.files.retrieveMetadata(fileId);
            const name = (meta.filename ?? "").toLowerCase();
            if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg")) {
              imageIds.push({ fileId, name });
            }
          } catch {
            // File may have expired; skip it rather than failing the turn.
          }
        }

        const lastImage = imageIds[imageIds.length - 1];
        if (lastImage) {
          try {
            const res = await getClient().beta.files.download(lastImage.fileId);
            const buf = Buffer.from(await res.arrayBuffer());
            send({
              t: "image",
              media_type: lastImage.name.endsWith(".png")
                ? "image/png"
                : "image/jpeg",
              data: buf.toString("base64"),
            });
          } catch {
            send({ t: "detail", v: "A chart was generated but could not be retrieved." });
          }
        }

        await store.setJSON(sessionId, state);

        if (truncated) {
          send({
            t: "error",
            v:
              "This turn hit the 60-second limit before finishing. The work so far is " +
              "saved — ask a narrower follow-up and the agent will pick up where it left off.",
          });
        }

        send({ t: "done" });
      } catch (err) {
        send({ t: "error", v: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
};

export const config: Config = {
  path: "/api/chat",
};
