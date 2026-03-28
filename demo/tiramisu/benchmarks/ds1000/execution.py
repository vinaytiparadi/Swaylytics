# Cross-platform execution sandbox for DS-1000 evaluation.
# Adapted from OpenAI's human-eval execution.py to work on Windows
# by using subprocess instead of multiprocessing + signal.SIGALRM.

from typing import Optional, Dict
import os
import subprocess
import sys
import tempfile


def check_correctness(
    program: str, timeout: float, completion_id: Optional[int] = None
) -> Dict:
    """
    Evaluates the functional correctness of a completion by running the test
    suite provided in the problem.

    Uses subprocess with timeout for cross-platform compatibility (Windows + Linux).
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        script_path = os.path.join(tmpdir, "test_script.py")
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(program)

        try:
            proc = subprocess.run(
                [sys.executable, script_path],
                cwd=tmpdir,
                capture_output=True,
                text=True,
                timeout=timeout,
                env={
                    **os.environ,
                    "MPLBACKEND": "Agg",
                    "QT_QPA_PLATFORM": "offscreen",
                },
            )
            if proc.returncode == 0:
                result = "passed"
            else:
                stderr = proc.stderr.strip()
                # Truncate very long error messages
                if len(stderr) > 500:
                    stderr = stderr[:500] + "..."
                result = f"failed: {stderr}" if stderr else "failed: non-zero exit"
        except subprocess.TimeoutExpired:
            result = "timed out"
        except Exception as e:
            result = f"failed: {e}"

    return dict(
        passed=result == "passed",
        result=result,
        completion_id=completion_id,
    )
