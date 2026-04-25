# Datasets

This document describes every dataset available to the NAID agent, including
grain, sources, and caveats. Every claim the agent makes must be traceable
back to one of these datasets.

All files are Apache Parquet format, stored in `data/`.

---

## 1. GTAP Labor Database

County-level US employment estimates, baseline and simulation scenarios. This
is the agent's primary quantitative resource for labor and policy impact
questions.

### Source pipeline

- **ACS (via IPUMS USA, 2021–2024)** — population anchor for all 65 GTAP sectors
- **NAWS FY2021–2022** — crop-agriculture distributional shares
- **USDA Census of Agriculture 2022** — commodity-level proration
- **GEOCORR 2022** — PUMA-to-county crosswalk

Baseline year: 2024. Simulation shocks applied at the 23-sector model level,
then distributed to 65 GTAP sectors.

### Files

#### `gtap_master_with_simulations.parquet`
Full 3,765,134-row dataset. Every combination of scenario × year × sector ×
skill × birthplace × county.

| Column | Type | Description |
|---|---|---|
| scenario | str | `baseline`, `JPM_sim03`, `JPM_sim03b`, `JPM_sim03c`, `USMCA_SR`, `USMCA_LR` |
| horizon | str | `SR` (short run) or `LR` (long run) |
| year | int | 2021–2024 for baseline; 2024 only for simulations |
| gtap_code | str | 65-sector GTAP code (e.g. `afs`, `cns`, `v_f`) |
| gtap_sector | str | Human-readable sector name |
| model_sector_code | str | 23-sector model aggregation code |
| model_sector_desc | str | Model-sector description |
| skill_level | str | `Skilled` or `Unskilled` |
| birthplace | str | `US born` or `Foreign born` |
| state | str | State name (full) |
| county_fips | str | 5-digit county FIPS code |
| county_name | str | County name (includes state suffix, e.g. "Autauga AL") |
| workers_base | float | Baseline employment (2024) |
| workers_sim | float | Simulated employment under scenario |
| workers_change | float | `workers_sim - workers_base` |
| pct_change | float | Percent change in employment |
| lq | float | Location Quotient (county specialization, capped at 2.0) |
| effective_delta | float | `δ(g) × LQ × ε × θ(skill)` — the effective % shock applied |
| n_in_sample | float | ACS sample size; mostly NaN (see caveats) |
| sim_desc | float | **All NaN — ignore this column** |

#### `gtap_dashboard.parquet`
Pre-aggregated version: 1,754,898 rows, 12 columns. Drops the horizon,
model_sector, pct_change, lq, effective_delta, sim_desc, and n_in_sample
columns. Use this for any query where those columns aren't needed — it's
~5× smaller.

#### `gtap_skill.parquet`
Highly aggregated: 1,500 rows. Groups across all counties, keeping only
scenario × year × gtap_code × skill × birthplace. Use for national
skill/birthplace breakdowns (pie charts, headline numbers).

### Scenarios

| Scenario | Shock |
|---|---|
| `baseline` | No shock — observed employment |
| `JPM_sim03` | 8.32M worker deportation (labor supply shock only) |
| `JPM_sim03b` | Deportation + 80% remittance reduction |
| `JPM_sim03c` | Deportation + remittance reduction + capital underutilization |
| `USMCA_SR` | US raises tariffs on all regions, short run, no retaliation |
| `USMCA_LR` | All regions reduce US imports 20%, ICRE FTA, long run |

### Caveats

- **H-2A workers excluded from NAWS source** — systematic underestimate of
  foreign-born labor in fruits/vegetables (sector `v_f`), especially in FL,
  GA, NC.
- **USDA data suppression** affects sugar (`c_b`) and wool (`wol`)
  proration — small states may be underestimated.
- **Population-based geographic allocation** (GEOCORR) approximates
  employment distribution with population distribution; error is small at
  national level but can be material for individual counties.
- **Simulation wage effects are not in this dataset** — see
  `data/model_inputs/jpm_wage_results.csv` for those. Note the +170%
  unauthorized-unskilled wage in JPM is a model scarcity artifact, not a
  forecast.
- **No standard errors included.** Worker counts in small counties or
  small sector cells carry substantial sampling error.

---

## 2. Diaspora GDP

State and national economic contribution of Mexican-origin and Latino
populations, 2023 data. Sourced from LDC/UCLA NAID Center reports.

### Files

#### `diaspora_wide.parquet` (preferred for state-level queries)
51 rows (50 states + DC), 14 columns. Wide format with pre-computed ratios.

| Column | Description |
|---|---|
| year | 2023 |
| state_name | Cleaned state name |
| total_state_gdp_billion_2023 | State's total GDP |
| latino_native_born_gdp_billion_2023 | Latino US-born GDP contribution |
| latino_foreign_born_gdp_billion_2023 | Latino foreign-born GDP contribution |
| latino_total_gdp_billion_2023 | All Latino GDP contribution |
| latino_gdp_as_pct_of_state_gdp | Share of state GDP from Latinos |
| mexican_native_born_gdp_billion_2023 | Mexican-origin US-born GDP |
| mexican_foreign_born_gdp_billion_2023 | Mexican-origin foreign-born GDP |
| mexican_total_gdp_billion_2023 | All Mexican-origin GDP |
| mexican_gdp_as_pct_of_state_gdp | Mexican share of state GDP |
| mexican_as_pct_of_latino_gdp | Mexican share of Latino GDP |
| state_abbrev | 2-letter code |

#### `diaspora_gdp_long.parquet`
1,754 rows, long format. Best when filtering by `metric_name` across
different metric types.

#### `diaspora_national.parquet`
8 rows. National totals by population group (Latino Native, Latino Foreign,
Non-Latino Foreign, Non-Latino Native × 2 years). Use for headline national
numbers only.

#### `diaspora_state.parquet`
305 rows. Long format state-level. Mostly superseded by `diaspora_wide`.

### Caveats

- **2023 data only** — no trajectory in this dataset. Historical GDP series
  not included.
- **Mexican-origin GDP is estimated**, not directly measured — derived from
  state Latino GDP × Mexican-origin population share.
- **Does not include undocumented workers as a separate category** —
  they're absorbed into "foreign-born" estimates.

---

## 3. Mexico Export Jobs

Jobs in Mexico tied to Mexican exports, broken down by US state of export
destination (where applicable) and Mexican model sector.

### Files

#### `mexico_export_jobs_state_totals.parquet`
52 rows — US states as export destinations. Jobs in Mexico generated by
exports TO that US state.

| Column | Description |
|---|---|
| year | 2023 |
| state_name / state_abbrev | US destination state |
| exports_millions | USD millions exported from Mexico to that state |
| jobs_direct | Jobs in Mexico directly from those exports |
| jobs_indirect | Indirect supply-chain jobs in Mexico |
| jobs_total | Sum of direct + indirect |
| jobs_per_1m_exports | Labor intensity (total jobs per $1M exports) |

#### `mexico_export_jobs_state_by_sector.parquet`
840 rows. Same structure but broken down by Mexican model sector.

#### `mexico_export_jobs_national_by_sector.parquet`
20 rows. Mexico's total export-linked jobs by sector (aggregated across
all destinations).

### Caveats

- **Perspective is Mexico-centric** — these are Mexican jobs dependent on
  US demand, NOT US jobs.
- **Only 20 sectors** appear in the national file; 3 model sectors have
  zero export-linked employment and are omitted.
- **Direct vs indirect distinction** comes from Mexican input-output tables;
  methodology and vintage should be confirmed before citing precisely.

---

## 4. Remittances to Mexico by US State of Origin

Quarterly and annual remittance flows from each US state to Mexico.

### File

#### `remittances_state_origin.parquet`
270 rows, 12 columns.

| Column | Description |
|---|---|
| period_raw / period_label | Raw period name, cleaned label |
| period_type | `annual` or quarterly |
| date | Timestamp (NaT for annual rows) |
| year | 4-digit year |
| quarter | Quarter number (null for annual) |
| origin_name | US state name or aggregate (e.g. "Other") |
| origin_type | `state` or other categories |
| state_abbrev | 2-letter code |
| is_mappable | `True` if origin is a real US state (for choropleth rendering) |
| remittances_musd | Remittances, millions USD |

### Caveats

- **Filter on `is_mappable=True` for maps** — some rows are aggregates.
- **Source is Banxico** (Banco de México); figures reflect Banxico
  methodology including informal flows estimates.
- **Recipient-side data only** — does not identify the individual senders,
  just the US state the money originated from.

---

## 5. Model Inputs (derivatives)

CSV files in `data/model_inputs/` extracted from the source Excel files.
These are the SECTORAL SHOCKS (inputs to the simulations), not labor
outcomes. Useful for answering questions like "what % output change did
sector X experience under scenario Y."

See `data/model_inputs/README.md` for full documentation.

Key files:
- `jpm_output_changes.csv` — JPM sectoral output shocks
- `usmca_output_changes.csv` — USMCA sectoral output shocks
- `jpm_macro_results.csv` — National GDP/exports/imports impacts
- `jpm_wage_results.csv` — Real wage changes by factor (contains the +170%
  unauthorized-unskilled artifact — cite carefully)

---

## General citation rules for the agent

When quoting any number from these datasets, the agent must include:

1. Which dataset (e.g. "GTAP dashboard, JPM_sim03 scenario")
2. Grain (county / state / national / sector-level)
3. Year or vintage
4. Any relevant caveat from the section above

Example format in agent responses:

> "Texas construction would lose approximately 45,000 foreign-born workers
> under the JPM_sim03 scenario (GTAP master, 2024 baseline, short-run
> horizon). Note: this reflects output-proportional employment assumptions;
> actual adjustment may occur partly through hours or wages rather than
> headcount."