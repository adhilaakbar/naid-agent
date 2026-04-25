"""Quick inspection of all Parquet files. Run once to see structure."""
import pandas as pd
import os

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")

for f in sorted(os.listdir(DATA_DIR)):
    if not f.endswith(".parquet"):
        continue
    path = os.path.join(DATA_DIR, f)
    df = pd.read_parquet(path)
    print("=" * 70)
    print(f"FILE: {f}")
    print(f"Shape: {df.shape[0]:,} rows × {df.shape[1]} columns")
    print(f"Columns: {list(df.columns)}")
    print(f"First 3 rows:")
    print(df.head(3).to_string())
    print(f"Dtypes:")
    print(df.dtypes.to_string())
    print()