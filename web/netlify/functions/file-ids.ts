/**
 * Anthropic Files API handles for the NAID datasets and methodology docs.
 *
 * These are committed deliberately. They are opaque handles scoped to the
 * NAID Anthropic account and are inert without ANTHROPIC_API_KEY — they
 * cannot be read, listed, or billed by anyone who does not already hold the
 * key. Committing them removes a 987-character environment variable that had
 * to be pasted by hand and re-pasted on every environment.
 *
 * Regenerate with scripts/upload_files.py after re-uploading any dataset,
 * or set the FILE_IDS environment variable to override without a code change.
 */
export const FILE_IDS: Record<string, string> = {
  "data/diaspora_gdp_long.parquet":                     "file_011CaPYe4KBEYxm2doirGmSx",
  "data/diaspora_national.parquet":                     "file_011CaPYe6h4JdskDRtHFCQGr",
  "data/diaspora_state.parquet":                        "file_011CaPYe8zDgujTH68WnYKuF",
  "data/diaspora_wide.parquet":                         "file_011CaPYeBMbhPFk4iWEAfoJL",
  "data/gtap_dashboard.parquet":                        "file_011CaPYeFXrumJptDa9eivja",
  "data/gtap_master_with_simulations.parquet":          "file_011CaPYeSwhu2uWAf9nbzz2z",
  "data/gtap_skill.parquet":                            "file_011CaPYeXoR8QBW1M6Hdm2uF",
  "data/mexico_export_jobs_national_by_sector.parquet": "file_011CaPYeaJyPAE6AzSounEyQ",
  "data/mexico_export_jobs_state_by_sector.parquet":    "file_011CaPYeckKEDQNnBwDwgaqF",
  "data/mexico_export_jobs_state_totals.parquet":       "file_011CaPYef2jtvZtSyTFAFTpE",
  "data/remittances_state_origin.parquet":              "file_011CaPYeh9Exqrunwb8x1xYv",
  "library/gtap_methodology.docx":                      "file_011CaPYejLCQDJhQUFXKgjFg",
  "library/gtap_visualization_methodology.docx":        "file_011CaPYemerQbCSRUrCuzQhm",
  "library/naid_working_paper_2026_final.pdf":          "file_011CanHiprXz2VZhksKEp5hQ",
};
