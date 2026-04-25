"""
One-time upload of all data files and methodology docs to Anthropic's Files API.
Saves file IDs to data/file_ids.json so the agent can reference them.
"""
import os
import json
from pathlib import Path
from dotenv import load_dotenv
from anthropic import Anthropic

load_dotenv()
client = Anthropic()

PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"
LIBRARY_DIR = PROJECT_ROOT / "library"
OUTPUT = PROJECT_ROOT / "data" / "file_ids.json"

# Files to upload: all Parquet files + any methodology docs in library/
files_to_upload = []
files_to_upload.extend(sorted(DATA_DIR.glob("*.parquet")))
files_to_upload.extend(sorted(DATA_DIR.glob("model_inputs/*.csv")))
files_to_upload.extend(sorted(LIBRARY_DIR.glob("*.md")))
files_to_upload.extend(sorted(LIBRARY_DIR.glob("*.docx")))

# Load existing file_ids if present (so we don't re-upload)
if OUTPUT.exists():
    existing = json.loads(OUTPUT.read_text())
else:
    existing = {}

results = dict(existing)

for path in files_to_upload:
    rel = str(path.relative_to(PROJECT_ROOT))
    if rel in results:
        print(f"SKIP (already uploaded): {rel}")
        continue
    print(f"Uploading: {rel}  ({path.stat().st_size / 1024:.1f} KB)")
    with open(path, "rb") as f:
        uploaded = client.beta.files.upload(
            file=(path.name, f, "application/octet-stream"),
        )
    results[rel] = uploaded.id
    print(f"  -> {uploaded.id}")

OUTPUT.write_text(json.dumps(results, indent=2))
print(f"\nSaved {len(results)} file IDs to {OUTPUT}")