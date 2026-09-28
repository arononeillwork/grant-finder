#!/usr/bin/env python3
"""Regenerate supabase/migrations/*_seed.sql from supabase/seed/*.json.
Usage: python3 scripts/build_seed.py   (then apply as a NEW migration if the DB already exists)"""
import json, pathlib
root = pathlib.Path(__file__).resolve().parents[1] / "supabase"
def lit(v):
    if v is None: return "null"
    if isinstance(v, bool): return "true" if v else "false"
    if isinstance(v, (int, float)): return str(v)
    if isinstance(v, list): return "array[" + ",".join(lit(x) for x in v) + "]::text[]" if v else "'{}'::text[]"
    return "'" + str(v).replace("'", "''") + "'"
def ins(table, rows):
    cols = list(rows[0].keys())
    vals = ",\n".join("(" + ",".join(lit(r[c]) for c in cols) + ")" for r in rows)
    return f"insert into public.{table} ({', '.join(cols)}) values\n{vals};\n"
data = {n: json.loads((root / "seed" / f"{n}.json").read_text()) for n in ["grants", "document_types", "grant_documents"]}
sql = "-- Seed data generated from supabase/seed/*.json (edit the JSON, then regenerate with scripts/build_seed.py).\n"
sql += ins("grants", data["grants"]) + "\n" + ins("document_types", data["document_types"]) + "\n" + ins("grant_documents", data["grant_documents"])
(root / "migrations" / "20260924000004_seed.sql").write_text(sql)
print({k: len(v) for k, v in data.items()})
