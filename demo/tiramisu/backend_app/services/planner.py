from __future__ import annotations

import ast
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


# ─── Hybrid Router: Gemini intervention functions ─────────────────────

_ERROR_INDICATORS = (
    "Traceback (most recent call last)",
    "[Timeout]:",
    "[Error]:",
    "ModuleNotFoundError",
    "FileNotFoundError",
    "KeyError:",
    "ValueError:",
    "TypeError:",
    "IndexError:",
    "NameError:",
    "AttributeError:",
    "PermissionError:",
    "SyntaxError:",
)


def is_execution_error(output: str) -> bool:
    return any(indicator in output for indicator in _ERROR_INDICATORS)


def _truncate(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n... (truncated)"


def _format_conversation(
    conversation: list[dict[str, str]],
    max_rounds: int = 3,
) -> str:
    pairs: list[str] = []
    i = len(conversation) - 1
    while i >= 0 and len(pairs) < max_rounds:
        msg = conversation[i]
        role = msg.get("role", "")
        content = msg.get("content", "")
        if role == "execute":
            assistant_content = ""
            if i > 0 and conversation[i - 1].get("role") == "assistant":
                assistant_content = _truncate(conversation[i - 1]["content"], 1500)
                i -= 1
            pairs.append(
                f"[Assistant]\n{assistant_content}\n\n"
                f"[Execution Output]\n{_truncate(content, 1000)}"
            )
        i -= 1
    pairs.reverse()
    return "\n\n---\n\n".join(pairs) if pairs else "(no conversation yet)"


def _extract_analysis_highlights(conversation: list[dict[str, str]]) -> str:
    highlights = []
    for msg in conversation:
        if msg.get("role") == "execute":
            content = msg.get("content", "")
            if content.strip():
                highlights.append(_truncate(content, 500))
    return "\n---\n".join(highlights[-5:])


def _call_gemini_sync(prompt_text: str, *, temperature: float = 0.7) -> str:
    url = GEMINI_API_URL.format(model=settings.gemini_model)
    with httpx.Client(timeout=120) as client:
        resp = client.post(
            url,
            headers={"x-goog-api-key": settings.gemini_api_key},
            json={
                "contents": [{"parts": [{"text": prompt_text}]}],
                "generationConfig": {
                    "temperature": temperature,
                    "thinkingConfig": {"thinkingLevel": "medium"},
                },
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]


ERROR_RECOVERY_PROMPT = textwrap.dedent("""\
    You are a senior data scientist supervising a junior analyst's code execution.
    The analyst's code failed. Diagnose the error and provide specific, actionable
    guidance to fix it.

    ## Original Task
    {user_prompt}

    ## Data Context
    {data_context}

    ## Recent Conversation (last {n_rounds} rounds)
    {recent_conversation}

    ## Failed Code
    ```python
    {failed_code}
    ```

    ## Error Output
    ```
    {error_output}
    ```

    ## Instructions
    1. Identify the root cause of the error (wrong column name, type mismatch,
       missing import, file path issue, etc.)
    2. Provide the specific fix — reference actual column names, data types, and
       file names from the data context
    3. If the approach is fundamentally flawed, suggest an alternative approach
    4. Keep your response under 300 words. Be direct and specific.

    IMPORTANT: End your response with a section titled "### Corrected Code" that
    contains the complete, corrected Python code block ready to run. Do NOT omit
    the corrected code — the analyst needs it to retry immediately.
""")


def call_gemini_error_recovery(
    user_prompt: str,
    data_context: str,
    conversation: list[dict[str, str]],
    failed_code: str,
    error_output: str,
) -> str | None:
    conv_text = _format_conversation(conversation, max_rounds=3)
    prompt = ERROR_RECOVERY_PROMPT.format(
        user_prompt=user_prompt,
        data_context=_truncate(data_context, 3000),
        n_rounds=min(3, len(conversation)),
        recent_conversation=conv_text,
        failed_code=failed_code,
        error_output=_truncate(error_output, 2000),
    )
    try:
        return _call_gemini_sync(prompt, temperature=0.3)
    except Exception:
        log.warning("Gemini error recovery call failed", exc_info=True)
        return None


CHECKPOINT_PROMPT = textwrap.dedent("""\
    You are a senior data scientist reviewing an ongoing automated analysis.
    Evaluate the agent's progress and provide brief steering guidance.

    ## Original Task
    {user_prompt}

    ## Analysis Plan
    {plan}

    ## Conversation So Far ({n_rounds} code executions completed)
    {conversation_summary}

    ## Instructions
    Evaluate in 150 words or less:
    1. Is the agent on track with the plan? What has it accomplished so far?
    2. What should it focus on next? Be specific (name columns, tests, charts).
    3. Any course corrections needed? (e.g., skipping a step, wrong approach,
       missing something important)

    Be concise. Only mention issues if they exist — don't pad with praise.
""")


def call_gemini_checkpoint(
    user_prompt: str,
    plan: str | None,
    conversation: list[dict[str, str]],
    successful_rounds: int,
) -> str | None:
    conv_text = _format_conversation(conversation, max_rounds=6)
    prompt = CHECKPOINT_PROMPT.format(
        user_prompt=user_prompt,
        plan=_truncate(plan or "(no plan provided)", 2000),
        n_rounds=successful_rounds,
        conversation_summary=conv_text,
    )
    try:
        return _call_gemini_sync(prompt, temperature=0.5)
    except Exception:
        log.warning("Gemini checkpoint call failed", exc_info=True)
        return None


# ─── Pre-execution Code Validator ─────────────────────────────────────

_STANDARD_IMPORTS = textwrap.dedent("""\
    import pandas as pd
    import numpy as np
    from scipy import stats
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import seaborn as sns
""")

_COMMON_ALIASES: dict[str, str] = {
    "pd": "pandas",
    "np": "numpy",
    "plt": "matplotlib.pyplot",
    "sns": "seaborn",
    "sm": "statsmodels.api",
    "stats": "scipy.stats",
}


def validate_code_before_execution(
    code: str,
    data_context: str,
    file_names: list[str] | None = None,
) -> tuple[str, str | None]:
    """Lightweight pre-execution validator (no Gemini call).

    Returns ``(patched_code, warning_or_none)``.
    *  Patches: auto-prepend missing imports and data-loading boilerplate.
    *  Warnings: flag references to unknown column names.
    """
    patches: list[str] = []
    warnings: list[str] = []

    # 1. Parse AST — bail on syntax errors (let execution report them)
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return code, None

    imported_names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                imported_names.add(alias.asname or alias.name.split(".")[0])

    used_names = {
        node.id for node in ast.walk(tree) if isinstance(node, ast.Name)
    }

    # Missing common imports?
    missing = {
        alias
        for alias in _COMMON_ALIASES
        if alias in used_names and alias not in imported_names
    }
    if missing:
        patches.append(_STANDARD_IMPORTS)

    # 2. Uses `df` but never loads it?
    uses_df = "df" in used_names
    has_read = any(
        kw in code
        for kw in ("read_csv", "read_excel", "read_json", "read_sql", "DataFrame(")
    )
    if uses_df and not has_read and "df" not in imported_names and file_names:
        for fn in file_names:
            ext = fn.rsplit(".", 1)[-1].lower()
            if ext in ("csv", "tsv"):
                patches.append(f"df = pd.read_csv('{fn}')")
                break
            if ext in ("xlsx", "xls"):
                patches.append(f"df = pd.read_excel('{fn}')")
                break

    # 3. Column references vs. known columns from data profile
    col_refs = set(re.findall(r"""df\[['"](.+?)['"]\]""", code))
    if col_refs and data_context:
        known_cols = set(re.findall(r'"name":\s*"([^"]+)"', data_context))
        if known_cols:
            unknown = col_refs - known_cols
            if unknown:
                warnings.append(
                    f"Unknown column(s) referenced: {', '.join(sorted(unknown))}. "
                    f"Available columns: {', '.join(sorted(known_cols))}"
                )

    # 4. Fix open() calls without encoding on Windows (prevents cp1252 errors)
    #    Matches: open('file', 'w') or open("file", "w") without encoding=
    patched_code = code
    _open_write_no_enc = re.compile(
        r"""open\(([^)]+?),\s*['"]w['"]\s*\)"""
    )
    for m in _open_write_no_enc.finditer(code):
        full_match = m.group(0)
        # Skip if encoding is already specified anywhere in the open() call
        # We need to check the full open() args, not just what we matched
        # Find the complete open(...) call
        start = m.start()
        depth = 0
        end = start
        for ci, ch in enumerate(code[start:], start):
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    end = ci + 1
                    break
        full_call = code[start:end]
        if "encoding" not in full_call:
            fixed = full_call.replace(
                m.group(0),
                full_match[:-1] + ", encoding='utf-8')",
            )
            patched_code = patched_code.replace(full_call, fixed)

    patched = ("\n".join(patches) + "\n\n" + patched_code) if patches else patched_code
    warning_msg = "\n".join(warnings) if warnings else None
    return patched, warning_msg
