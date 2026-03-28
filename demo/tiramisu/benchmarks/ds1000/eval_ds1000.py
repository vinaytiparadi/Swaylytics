"""DS-1000 benchmark evaluation.

Reads generated answers and runs test cases to compute pass rates.

Usage:
    python eval_ds1000.py --model gemini-3-flash-preview
    python eval_ds1000.py --model gemini-3-flash-preview --exclude Pytorch
"""

import argparse
import concurrent.futures as cfuts
import gzip
import json
import os
import re
import sys
from pathlib import Path

import pandas as pd
from tqdm import tqdm

import execution

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_DATA_PATH = str(
    Path(__file__).resolve().parent.parent.parent.parent.parent
    / "playground"
    / "DS-1000"
    / "data"
    / "ds1000.jsonl.gz"
)

# Disable TF logging and GPU for evaluation
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
os.environ["CUDA_VISIBLE_DEVICES"] = "-1"


# ---------------------------------------------------------------------------
# Post-processing (matches playground/DS-1000/test_ds1000.py)
# ---------------------------------------------------------------------------


def extract_python_block(text):
    """Extract the last ```python ... ``` code block from text."""
    if text is None:
        return None
    if isinstance(text, list):
        text = text[0]
    pattern = r"```python.*?```"
    matches = re.findall(pattern, text, flags=re.DOTALL)
    if matches:
        return matches[-1].strip()
    return None


def postprocess(code):
    """Clean up extracted code."""
    if code is None:
        return ""
    if isinstance(code, list):
        code = code[0]
    code = code.split("</Code>")[0]
    code = code.replace("```python", "")
    code = code.split("```")[0]
    code = code.split("\nEND SOLUTION")[0]
    code = code.replace("<Code>", "")
    return code


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------


def eval_ds1000(
    ds1000: list[dict],
    answers: list[str],
    exclude_libs: set[str] | None = None,
    workers: int = 16,
):
    """Run evaluation and return summary string + detailed results."""
    results = []

    with cfuts.ThreadPoolExecutor(max_workers=workers) as executor:
        futs = []
        for p in ds1000:
            pid = int(p["metadata"]["problem_id"])
            lib = p["metadata"]["library"]

            test_program = (
                p["code_context"]
                + "\n"
                + f"code = {repr(answers[pid])}\n"
                + "test_execution(code)\n"
                + (
                    "test_string(code)\n"
                    if "test_string(" in p["code_context"]
                    else "\n"
                )
            )
            futs.append(
                executor.submit(
                    execution.check_correctness,
                    test_program,
                    timeout=120,
                    completion_id=pid,
                )
            )

        for f in tqdm(cfuts.as_completed(futs), total=len(futs), desc="Evaluating"):
            result = f.result()
            cid = result["completion_id"]
            result["score"] = 1 if result["passed"] else 0
            result["library"] = ds1000[cid]["metadata"]["library"]
            result["perturbation_type"] = ds1000[cid]["metadata"]["perturbation_type"]
            results.append(result)

    df = pd.DataFrame.from_records(results)
    pd.set_option("display.precision", 3)

    # Full summary (all libraries)
    summary_parts = ["=" * 60, "FULL RESULTS (all libraries)", "=" * 60]
    summary_parts.append(df.agg({"score": ["count", "mean"]}).to_string())
    summary_parts.append("")
    summary_parts.append(
        df[["library", "score"]]
        .groupby("library")
        .agg({"score": ["count", "mean"]})
        .to_string()
    )
    summary_parts.append("")
    summary_parts.append(
        df[["perturbation_type", "score"]]
        .groupby("perturbation_type")
        .agg({"score": ["count", "mean"]})
        .to_string()
    )

    # Filtered summary (excluding specified libraries)
    if exclude_libs:
        df_filtered = df[~df["library"].isin(exclude_libs)]
        summary_parts.append("")
        summary_parts.append("=" * 60)
        summary_parts.append(f"FILTERED RESULTS (excluding {', '.join(sorted(exclude_libs))})")
        summary_parts.append("=" * 60)
        summary_parts.append(df_filtered.agg({"score": ["count", "mean"]}).to_string())
        summary_parts.append("")
        summary_parts.append(
            df_filtered[["library", "score"]]
            .groupby("library")
            .agg({"score": ["count", "mean"]})
            .to_string()
        )
        summary_parts.append("")
        summary_parts.append(
            df_filtered[["perturbation_type", "score"]]
            .groupby("perturbation_type")
            .agg({"score": ["count", "mean"]})
            .to_string()
        )

    summary = "\n".join(summary_parts)
    return summary, results


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description="DS-1000 evaluation")
    parser.add_argument("--model", type=str, required=True, help="Model name (matches answers filename)")
    parser.add_argument(
        "--exclude", type=str, default="Pytorch",
        help="Comma-separated library names to exclude from filtered summary (default: Pytorch)",
    )
    parser.add_argument("--workers", type=int, default=16, help="Parallel workers (default: 16)")
    parser.add_argument(
        "--data", type=str, default=DEFAULT_DATA_PATH,
        help="Path to ds1000.jsonl.gz",
    )
    args = parser.parse_args()

    # Load dataset
    ds1000 = [json.loads(line) for line in gzip.open(args.data, "rt").readlines()]
    print(f"Loaded {len(ds1000)} problems")

    # Load answers
    answers_path = Path(__file__).resolve().parent / "data" / f"{args.model}-answers.jsonl"
    if not answers_path.exists():
        print(f"Error: answers file not found: {answers_path}", file=sys.stderr)
        sys.exit(1)

    generated = [json.loads(line) for line in open(answers_path, "r").readlines()]
    answers = [postprocess(extract_python_block(rec.get("response", ""))) for rec in generated]
    print(f"Loaded {len(answers)} answers from {answers_path}")

    non_empty = sum(1 for a in answers if a.strip())
    print(f"Non-empty answers: {non_empty}")

    # Parse exclusions
    exclude_libs = set()
    if args.exclude:
        exclude_libs = {lib.strip() for lib in args.exclude.split(",") if lib.strip()}

    # Run evaluation
    print(f"\nRunning evaluation with {args.workers} workers...")
    summary, results = eval_ds1000(ds1000, answers, exclude_libs, args.workers)

    # Print results
    print("\n" + summary)

    # Save results
    results_dir = Path(__file__).resolve().parent / "results"
    results_dir.mkdir(exist_ok=True)

    with open(results_dir / f"{args.model}-result.txt", "w") as f:
        f.write(summary)

    with open(results_dir / f"{args.model}-log.json", "w", encoding="utf-8") as f:
        json.dump(results, f, indent=4, ensure_ascii=False)

    print(f"\nResults saved to {results_dir / args.model}-result.txt")
    print(f"Detailed log saved to {results_dir / args.model}-log.json")


if __name__ == "__main__":
    main()
