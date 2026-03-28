"""DS-1000 benchmark inference using Gemini API.

Usage:
    python run_gemini.py --range 1-100          # Run problems 1-100 (1-indexed)
    python run_gemini.py --all                   # Run all non-PyTorch problems (932)
    python run_gemini.py --all --resume          # Resume interrupted run
    python run_gemini.py --all --workers 8       # Custom concurrency
"""

import argparse
import concurrent.futures as cfuts
import gzip
import json
import logging
import os
import random
import re
import sys
import time
from pathlib import Path

import httpx
from tqdm import tqdm

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
)
log = logging.getLogger(__name__)


def _load_env():
    """Load .env from tiramisu root (two levels up)."""
    env_path = Path(__file__).resolve().parent.parent.parent / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


_load_env()

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

GEMINI_API_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}"
    ":generateContent"
)

SYSTEM_PROMPT = (
    "You are a code completion assistant. Complete the Python code as requested. "
    "Only provide the code that goes in the solution block. "
    "Do not repeat the context code. Do not add explanations. "
    "Write your solution inside a ```python code block."
)

RETRYABLE_STATUS = {429, 500, 502, 503}
RETRY_BACKOFF = [2, 5, 10]
MAX_RETRIES = 3

DEFAULT_DATA_PATH = str(
    Path(__file__).resolve().parent.parent.parent.parent.parent
    / "playground"
    / "DS-1000"
    / "data"
    / "ds1000.jsonl.gz"
)

# ---------------------------------------------------------------------------
# Gemini API
# ---------------------------------------------------------------------------


def call_gemini(
    prompt: str,
    model: str,
    api_key: str,
    temperature: float = 0.0,
) -> str:
    """Call Gemini generateContent (non-streaming) with retries."""
    url = GEMINI_API_URL.format(model=model)
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": 2048,
            "stopSequences": ["</code>", "# SOLUTION END"],
            "thinkingConfig": {"thinkingLevel": "high"},
        },
    }

    last_exc = None
    for attempt in range(MAX_RETRIES):
        try:
            with httpx.Client(timeout=120) as client:
                resp = client.post(
                    url,
                    headers={
                        "Content-Type": "application/json",
                        "x-goog-api-key": api_key,
                    },
                    json=body,
                )
                if resp.status_code in RETRYABLE_STATUS:
                    wait = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
                    log.warning(
                        "Gemini %s, retry in %ds (%d/%d)",
                        resp.status_code, wait, attempt + 1, MAX_RETRIES,
                    )
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                data = resp.json()

            # Extract non-thinking text from response parts
            candidates = data.get("candidates") or []
            if not candidates:
                return ""
            parts = candidates[0].get("content", {}).get("parts") or []
            text_parts = [
                p["text"] for p in parts
                if p.get("text") and not p.get("thought")
            ]
            return "\n".join(text_parts)

        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in RETRYABLE_STATUS:
                last_exc = exc
                wait = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
                log.warning(
                    "Gemini HTTP %s, retry in %ds (%d/%d)",
                    exc.response.status_code, wait, attempt + 1, MAX_RETRIES,
                )
                time.sleep(wait)
                continue
            log.error("Gemini non-retryable error: %s", exc)
            return ""
        except (httpx.ConnectError, httpx.ReadTimeout) as exc:
            last_exc = exc
            wait = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
            log.warning(
                "Gemini connection error, retry in %ds (%d/%d): %s",
                wait, attempt + 1, MAX_RETRIES, exc,
            )
            time.sleep(wait)
            continue
        except Exception as exc:
            log.error("Unexpected error calling Gemini: %s", exc)
            return ""

    log.error("All retries exhausted: %s", last_exc)
    return ""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def extract_python_block(text: str) -> str | None:
    """Extract the last ```python ... ``` code block from text."""
    if not text:
        return None
    pattern = r"```python.*?```"
    matches = re.findall(pattern, text, flags=re.DOTALL)
    if matches:
        return matches[-1].strip()
    return None


def load_dataset(data_path: str) -> list[dict]:
    """Load DS-1000 dataset from gzipped JSONL."""
    log.info("Loading dataset from %s", data_path)
    ds = [json.loads(line) for line in gzip.open(data_path, "rt").readlines()]
    log.info("Loaded %d problems", len(ds))
    return ds


def resolve_target_ids(
    args: argparse.Namespace, ds1000: list[dict]
) -> set[int]:
    """Determine which problem IDs to run."""
    # Build set of PyTorch IDs
    pytorch_ids = {
        int(p["metadata"]["problem_id"])
        for p in ds1000
        if p["metadata"]["library"] == "Pytorch"
    }

    if args.all:
        target = set(range(len(ds1000))) - pytorch_ids
    elif args.range:
        start_str, end_str = args.range.split("-")
        start, end = int(start_str), int(end_str)
        # 1-indexed inclusive → 0-indexed
        all_in_range = set(range(start - 1, end))
        target = all_in_range - pytorch_ids
    else:
        print("Error: must specify --all or --range", file=sys.stderr)
        sys.exit(1)

    # Clamp to valid IDs
    target = {i for i in target if 0 <= i < len(ds1000)}
    return target


def load_completed_ids(filepath: str) -> dict[int, dict]:
    """Load existing answers and return {id: record} for completed ones."""
    existing = {}
    if not os.path.exists(filepath):
        return existing
    with open(filepath, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            pid = int(rec["id"])
            if rec.get("response", "").strip():
                existing[pid] = rec
    return existing


def build_full_output(
    ds1000: list[dict],
    new_results: dict[int, dict],
    existing: dict[int, dict],
) -> list[dict]:
    """Merge new results with existing into a 1000-line list."""
    output = []
    for i in range(len(ds1000)):
        if i in new_results:
            output.append(new_results[i])
        elif i in existing:
            output.append(existing[i])
        else:
            # Placeholder for skipped/PyTorch problems
            output.append({
                "id": i,
                "code": "",
                "response": "",
                "metadata": ds1000[i]["metadata"],
            })
    return output


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description="DS-1000 Gemini inference")
    parser.add_argument("--range", type=str, help="Problem range, 1-indexed inclusive (e.g., 1-100)")
    parser.add_argument("--all", action="store_true", help="Run all non-PyTorch problems")
    parser.add_argument("--resume", action="store_true", help="Skip already-completed IDs")
    parser.add_argument("--workers", type=int, default=16, help="Concurrent workers (default: 16)")
    parser.add_argument("--temperature", type=float, default=0.0, help="Temperature (default: 0.0)")
    parser.add_argument(
        "--model", type=str,
        default=os.getenv("GEMINI_MODEL", "gemini-3-flash-preview"),
        help="Gemini model name",
    )
    parser.add_argument(
        "--data", type=str, default=DEFAULT_DATA_PATH,
        help="Path to ds1000.jsonl.gz",
    )
    args = parser.parse_args()

    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        print("Error: GEMINI_API_KEY env var not set", file=sys.stderr)
        sys.exit(1)

    ds1000 = load_dataset(args.data)
    target_ids = resolve_target_ids(args, ds1000)

    output_dir = Path(__file__).resolve().parent / "data"
    output_dir.mkdir(exist_ok=True)
    output_path = str(output_dir / f"{args.model}-answers.jsonl")

    # Resume: load existing completed answers
    existing = {}
    if args.resume:
        existing = load_completed_ids(output_path)
        before = len(target_ids)
        target_ids -= set(existing.keys())
        log.info("Resume: %d already completed, %d remaining", before - len(target_ids), len(target_ids))

    if not target_ids:
        log.info("No problems to run.")
        return

    log.info(
        "Running %d problems with model=%s, workers=%d, temperature=%.1f",
        len(target_ids), args.model, args.workers, args.temperature,
    )

    # Run inference
    new_results: dict[int, dict] = {}

    def process_problem(pid: int) -> dict:
        prompt = ds1000[pid]["prompt"]
        response = call_gemini(prompt, args.model, api_key, args.temperature)
        time.sleep(random.uniform(1.0, 2.0))
        code = extract_python_block(response)
        return {
            "id": pid,
            "code": code or "",
            "response": response,
            "metadata": ds1000[pid]["metadata"],
        }

    with cfuts.ThreadPoolExecutor(max_workers=args.workers) as executor:
        futs = {
            executor.submit(process_problem, pid): pid
            for pid in sorted(target_ids)
        }
        for fut in tqdm(cfuts.as_completed(futs), total=len(futs), desc="Gemini inference"):
            pid = futs[fut]
            try:
                result = fut.result()
                new_results[pid] = result
            except Exception as exc:
                log.error("Problem %d failed: %s", pid, exc)
                new_results[pid] = {
                    "id": pid,
                    "code": "",
                    "response": "",
                    "metadata": ds1000[pid]["metadata"],
                }

    # Build and write full output
    output = build_full_output(ds1000, new_results, existing)

    with open(output_path, "w", encoding="utf-8") as f:
        for rec in output:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    non_empty = sum(1 for r in output if r.get("response", "").strip())
    log.info("Written %d answers (%d non-empty) to %s", len(output), non_empty, output_path)


if __name__ == "__main__":
    main()
