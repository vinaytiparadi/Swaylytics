from __future__ import annotations

import json
import logging
import re
import textwrap
from typing import Any

import httpx

from .execution import execute_code_safe
from .workspace import get_session_workspace
from ..settings import settings

log = logging.getLogger(__name__)

PROFILE_START = "__PROFILE_JSON_START__"
PROFILE_END = "__PROFILE_JSON_END__"

GEMINI_API_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)

GEMINI_PROMPT_TEMPLATE = textwrap.dedent("""\
    You are an expert data science planning assistant. Given a user's analysis \
    request and a detailed profile of their dataset(s), create a structured \
    analysis plan that a coding agent will follow.

    ## User's Request
    {user_prompt}

    ## Data Profile
    {data_profile}

    ## Instructions
    Create a concise, actionable analysis plan with these sections:

    ### Data Understanding
    Key observations about the data: types, quality issues, size, relationships \
    between files/tables.

    ### Hypotheses
    2-8 testable hypotheses or questions to investigate based on the user's \
    request and the data profile. Be specific — reference column names.

    ### Analysis Steps
    5-10 numbered steps. For each step include:
    - What to do (be specific: "compute correlation between X and Y", not "analyze data")
    - Which columns/tables to use
    - Expected output (table, chart, metric, or statistical test)

    ### Potential Pitfalls
    2-3 data quality or methodological issues to watch out for (missing values, \
    skew, multicollinearity, etc.). Reference specific columns from the profile.

    ### Key Visualizations
    2-4 specific charts to produce with code snippets, with axis labels and chart types.

    Keep the plan under 2000 words. Be specific about column names and data types \
    from the profile. Format in clean markdown.
""")


def build_profiling_script(file_names: list[str]) -> str:
    names_literal = json.dumps(file_names, ensure_ascii=False)
    return textwrap.dedent(f"""\
        import json, os, sys

        FILE_NAMES = {names_literal}
        profile = {{"files": []}}

        for fname in FILE_NAMES:
            if not os.path.exists(fname):
                continue
            ext = os.path.splitext(fname)[1].lower()
            entry = {{"name": fname, "size_bytes": os.path.getsize(fname)}}

            try:
                if ext in ('.csv', '.tsv'):
                    import pandas as pd
                    sep = '\\t' if ext == '.tsv' else ','
                    df = pd.read_csv(fname, sep=sep, nrows=5000)
                    entry["type"] = "tabular"
                    entry["shape"] = list(df.shape)
                    cols = []
                    for col in df.columns:
                        ci = {{
                            "name": str(col),
                            "dtype": str(df[col].dtype),
                            "null_count": int(df[col].isna().sum()),
                            "unique_count": int(df[col].nunique()),
                        }}
                        if df[col].dtype.kind in ('i', 'f'):
                            desc = df[col].describe().to_dict()
                            ci["stats"] = {{k: round(float(v), 4) for k, v in desc.items() if k != 'count'}}
                        else:
                            ci["sample_values"] = [str(x) for x in df[col].dropna().unique()[:5]]
                        cols.append(ci)
                    entry["columns"] = cols
                    entry["sample_rows"] = json.loads(df.head(15).to_json(orient='records', force_ascii=False))

                elif ext in ('.xlsx', '.xls'):
                    import pandas as pd
                    xls = pd.ExcelFile(fname)
                    entry["type"] = "excel"
                    entry["sheet_names"] = xls.sheet_names[:10]
                    df = xls.parse(xls.sheet_names[0], nrows=5000)
                    entry["shape"] = list(df.shape)
                    cols = []
                    for col in df.columns:
                        ci = {{
                            "name": str(col),
                            "dtype": str(df[col].dtype),
                            "null_count": int(df[col].isna().sum()),
                            "unique_count": int(df[col].nunique()),
                        }}
                        if df[col].dtype.kind in ('i', 'f'):
                            desc = df[col].describe().to_dict()
                            ci["stats"] = {{k: round(float(v), 4) for k, v in desc.items() if k != 'count'}}
                        else:
                            ci["sample_values"] = [str(x) for x in df[col].dropna().unique()[:5]]
                        cols.append(ci)
                    entry["columns"] = cols
                    entry["sample_rows"] = json.loads(df.head(15).to_json(orient='records', force_ascii=False))

                elif ext == '.json':
                    with open(fname, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    entry["type"] = "json"
                    if isinstance(data, list):
                        entry["length"] = len(data)
                        entry["sample_entries"] = data[:10]
                        if data and isinstance(data[0], dict):
                            entry["keys"] = list(data[0].keys())
                    elif isinstance(data, dict):
                        entry["keys"] = list(data.keys())[:20]
                        entry["sample"] = {{k: repr(v)[:200] for k, v in list(data.items())[:10]}}

                elif ext in ('.sqlite', '.db'):
                    import sqlite3
                    conn = sqlite3.connect(fname)
                    tables = [r[0] for r in conn.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'"
                    ).fetchall()]
                    entry["type"] = "database"
                    entry["tables"] = []
                    for t in tables[:10]:
                        cols = [(r[1], r[2]) for r in conn.execute(
                            f'PRAGMA table_info("{{t}}")'
                        ).fetchall()]
                        row_count = conn.execute(f'SELECT COUNT(*) FROM "{{t}}"').fetchone()[0]
                        entry["tables"].append({{"name": t, "columns": cols, "row_count": row_count}})
                    conn.close()

                else:
                    with open(fname, 'r', encoding='utf-8', errors='replace') as f:
                        lines = f.readlines()
                    entry["type"] = "text"
                    entry["line_count"] = len(lines)
                    entry["preview"] = ''.join(lines[:50])

            except Exception as e:
                entry["error"] = str(e)

            profile["files"].append(entry)

        print("{PROFILE_START}")
        print(json.dumps(profile, ensure_ascii=False, default=str))
        print("{PROFILE_END}")
    """)


def _parse_profile_output(output: str) -> dict[str, Any] | None:
    match = re.search(
        rf"{re.escape(PROFILE_START)}\s*(.*?)\s*{re.escape(PROFILE_END)}",
        output,
        re.DOTALL,
    )
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return None


async def call_gemini_planner(user_prompt: str, data_profile: dict) -> str:
    profile_str = json.dumps(data_profile, indent=2, ensure_ascii=False, default=str)
    if len(profile_str) > 12000:
        profile_str = profile_str[:12000] + "\n... (truncated)"

    prompt_text = GEMINI_PROMPT_TEMPLATE.format(
        user_prompt=user_prompt,
        data_profile=profile_str,
    )

    url = GEMINI_API_URL.format(model=settings.gemini_model)

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            url,
            headers={"x-goog-api-key": settings.gemini_api_key},
            json={
                "contents": [{"parts": [{"text": prompt_text}]}],
                "generationConfig": {
                    "temperature": 1.0,
                    "thinkingConfig": {
                        "thinkingLevel": "medium",
                    },
                },
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]


async def generate_plan(
    session_id: str,
    user_prompt: str,
    workspace_files: list[str],
) -> dict[str, Any]:
    if not settings.planning_enabled:
        return {"plan": None, "reason": "planning_disabled"}

    workspace_dir = get_session_workspace(session_id)

    try:
        script = build_profiling_script(workspace_files)
        raw_output = execute_code_safe(script, workspace_dir, session_id, timeout_sec=30)
        profile = _parse_profile_output(raw_output)
        if not profile:
            log.warning("Profiling script produced no parseable output: %s", raw_output[:500])
            return {"plan": None, "error": "Data profiling failed to produce output"}
    except Exception as exc:
        log.warning("Data profiling failed: %s", exc)
        return {"plan": None, "error": f"Data profiling failed: {exc}"}

    try:
        plan_text = await call_gemini_planner(user_prompt, profile)
        return {"plan": plan_text, "data_profile": profile}
    except Exception as exc:
        log.warning("Gemini planner call failed: %s", exc)
        return {"plan": None, "error": f"Gemini planner failed: {exc}"}
