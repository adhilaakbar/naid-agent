# NAID Agent — Netlify build

TypeScript port of the Streamlit agent, built to run as a Netlify Function so it
can live in the agents tab of the main site.

The Streamlit app at the repo root is untouched — both can run side by side
against the same Anthropic Files API data.

## Why this works

The agent has no local tools. Both tools are Anthropic server-side:

- `code_execution` — pandas over the parquet files, in Anthropic's container
- `web_search` — current policy news

The parquet files live in the Files API and are attached as `container_upload`
blocks, so there is no data to migrate and nothing to re-upload. The backend is
purely an orchestration loop over the Messages API, which is why it ports to
TypeScript cleanly.

## Layout

```
netlify.toml                        # at repo root, base = "web"
web/
  netlify/functions/chat.mts        # the agent loop  (port of agent/core.py)
  netlify/functions/system-prompt.ts# port of agent/system_prompt.py
  public/index.html                 # chat UI, no build step, no framework
  package.json
```

## Environment variables

Set these in **Netlify → Site configuration → Environment variables**.

| Variable | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Your `sk-ant-…` key. If Netlify's AI Gateway has claimed this name, use `NAID_ANTHROPIC_API_KEY` instead — it takes precedence |
| `SITE_PASSWORD` | recommended | Shared password gate. **Without it, anyone who finds the URL spends your API credits.** |
| `NAID_EFFORT` | no | `low` \| `medium` \| `high` \| `xhigh` \| `max`. Defaults to `medium` |
| `FILE_IDS` | no | Override only. Ids are committed in `netlify/functions/file-ids.ts` |

**Set scope to All scopes and apply to all deploy contexts.** A variable scoped
to Builds only exists in the dashboard but is invisible to `process.env` at
runtime. Netlify also binds variables at build time, so **trigger a new deploy
after changing one** — editing a variable does not affect the running deploy.

Check what the function can actually read at **`/api/health`**. It reports which
variables are visible and diagnoses a malformed key without echoing any values.

### Why the file ids are committed

`file-ids.ts` holds the 14 Files API handles. They are opaque references scoped
to the NAID Anthropic account and are inert without the API key — they cannot be
read, listed, or billed by anyone who does not already hold it. Committing them
removes a 987-character variable that otherwise had to be pasted by hand into
every environment and re-pasted whenever it drifted.

Re-run `scripts/upload_files.py` and regenerate `file-ids.ts` if a dataset is
re-uploaded, or set `FILE_IDS` to override without touching code.

## Deploy

```bash
# from the repo root
netlify init      # or connect the repo in the Netlify UI
netlify deploy --prod
```

Netlify reads `netlify.toml` at the repo root, which sets `base = "web"`, so it
installs `web/package.json` and publishes `web/public`.

Then point a subdomain (`agent.yourdomain.org`) at the site under
**Domain management**, and either link to it from the agents tab or iframe it.

## Local development

```bash
cd web
npm install
# web/.env supplies ANTHROPIC_API_KEY and FILE_IDS to the function
netlify dev
```

## The 30-second ceiling

Netlify's docs state a 60-second limit for streaming functions. **Measured
against this site, the platform kills the invocation at a hard ~30 seconds** —
five consecutive runs died at 29.7-30.2s regardless of workload, with no error
and a clean socket close. Budget against 30s, not 60s.

Measured against live data:

| Query | Rounds | Time |
|---|---|---|
| Row/column count on one parquet | 1 | ~10s |
| Top-5 bar chart from remittances | 3 code calls | ~30s |

Simple lookups finish comfortably. **Chart generation and multi-dataset research
sit right at the ceiling and will often be cut off.**

The loop stops starting new model rounds at 24s and sends a closing message, and
state is persisted after every round — so a cut turn keeps its container and
history, and a narrower follow-up continues from where it stopped rather than
starting over.

### If that is too tight

The fix is a background function (15-minute limit) that writes results to
Netlify Blobs, with the page polling for completion. That trades the live
token-by-token stream for a progress indicator, and is the only way to exceed
30s on this host. Worth doing if chart-heavy questions are the common case.

## Two changes forced by serverless

**State.** `NAIDAgent` kept `messages` and `container_id` on the instance because
Streamlit holds one process per session. Every function invocation here is a cold
process, so conversation state lives in Netlify Blobs keyed by a session id. The
browser only holds that id.

**Generated charts.** `core.py` primed a set from an account-wide `files.list()`
at startup and diffed against it to find new PNGs. That priming can't survive a
cold start and would re-list every file on every request. The current
code-execution tool returns generated file ids directly on the result block, so
this build reads them from there — no listing, no diffing, no cold-start cost.

## Versions

The Streamlit app pins `claude-sonnet-4-6` with `code_execution_20250825` and
`web_search_20250305`. This build uses `claude-opus-5` with
`code_execution_20260521`.

Web search is deliberately left on the basic `web_search_20250305`. The newer
`web_search_20260209` runs code execution internally for dynamic filtering, and a
second execution environment alongside the agent's own `code_execution` tool
confuses the model — the docs warn against declaring both.

`max_tokens` is 16000 rather than core.py's 4000: thinking is on by default on
Opus 5 and `max_tokens` caps thinking plus response text together, so the old
budget would truncate answers mid-sentence.
