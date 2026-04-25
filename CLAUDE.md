# CLAUDE.md

## Project: NAID Agent

A new AI agent for the UCLA NAID Center that provides policy-grade answers on US–Mexico economic integration, Mexican-origin and Latino economic contributions, and immigration/trade policy impacts.

Audience: researchers, professors, and policy offices (including the president of Mexico's team). Outputs must be accurate, cited, and appropriate for briefing use.

## Tech stack

- Python 3.11+
- Streamlit (frontend)
- Anthropic Python SDK (Claude API)
- pandas + pyarrow (data)
- plotly (charts and maps)
- python-pptx (presentation generation)

## Architecture

Four data sources, all Parquet files in `data/`:

- **GTAP labor dashboard** — county × sector × skill × birthplace employment, baseline + 5 simulation scenarios (deportation and USMCA). Files: `gtap_master_with_simulations.parquet`, `gtap_dashboard.parquet`, `gtap_skill.parquet`.
- **Diaspora GDP** — Mexican-origin and Latino economic contributions by state. Files: `diaspora_gdp_long.parquet`, `diaspora_national.parquet`, `diaspora_state.parquet`, `diaspora_wide.parquet`.
- **Mexico Export Jobs** — jobs in Mexico tied to US exports, by state and sector. Files: `mexico_export_jobs_state_totals.parquet`, `mexico_export_jobs_state_by_sector.parquet`, `mexico_export_jobs_national_by_sector.parquet`.
- **Remittances** — US-state-of-origin to Mexico flows. File: `remittances_state_origin.parquet`.

Plus a methodology library in `library/` with the GTAP methodology docs and (eventually) other academic references.

## Agent tools (target for v1)

1. `get_dataset_info(dataset_name)` — metadata for any of the four datasets
2. `query_data(dataset_name, filters, group_by, metric, top_n)` — unified query across all datasets
3. `search_methodology(question)` — RAG over `library/`
4. `search_web(query)` — current news, policy updates, new research
5. `create_map` / `create_chart` — choropleth and chart visualizations
6. `generate_pptx(topic, audience)` — briefing deck generation

## Conventions

- Every numeric result must carry provenance: dataset, vintage, and relevant caveats.
- Filter parameters are validated; unknown columns raise errors rather than silently dropping (a fix from the reference `tools.py`).
- Parquet files are loaded once at startup and cached; never mutated by the agent.
- System prompt enforces citation on every factual claim; refuses to invent numbers when uncertain.

## Reference material

The existing `gtap-labor-explorer` repo has a working Streamlit app with a simpler "Ask Claude" tab and the original `tools.py`. Located at `../gtap-labor-explorer/` relative to this project. Use as reference for map and chart code to port — but do not copy blindly. The new agent has broader scope (all four datasets, not one at a time) and stricter citation requirements.

## Out of scope for v1

- Modifying the upstream Stata pipeline
- Regenerating Parquet files from raw sources
- Real-time streaming data (quarterly refresh is sufficient)
- Full user authentication (password gate is enough for MVP)