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
| `ANTHROPIC_API_KEY` | yes | Same key the Streamlit app uses |
| `FILE_IDS` | yes | The full contents of `data/file_ids.json`, as one line of JSON |
| `SITE_PASSWORD` | recommended | Shared password gate. **Without it, anyone who finds the URL spends your API credits.** |
| `NAID_EFFORT` | no | `low` \| `medium` \| `high` \| `xhigh` \| `max`. Defaults to `medium` |

`FILE_IDS` is a single-line JSON object — paste `data/file_ids.json` as-is:

```json
{"data/diaspora_gdp_long.parquet":"file_011C...","data/gtap_dashboard.parquet":"file_011C...", ...}
```

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

## The 60-second ceiling

Netlify caps function execution at 60 seconds. This is fixed — not configurable,
and identical on every plan including Enterprise.

Measured against live data:

| Query | Rounds | Time |
|---|---|---|
| Row/column count on one parquet | 1 | 10.3s |
| Top-5 bar chart from remittances | 3 code calls | 25.5s |

So typical questions land comfortably inside the budget. Deep multi-dataset
research with web search can exceed it. The function stops starting new model
rounds at 52s and returns what it has with a note, so a long turn degrades into a
partial answer rather than a dropped connection — and because state is persisted,
a narrower follow-up resumes from the same container.

If long turns become common in practice, the fix is a background function (15
min) writing to Netlify Blobs with the UI polling. Don't build that until you've
measured it.

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
