"""decoding a snoop capture into our internal records by replaying it through
open_ring's driver.

the heavy lifting (parsing the BLE protocol out of a btsnoop capture) lives in
open_ring; we just shell out to its replay CLI and stream the JSONL it prints
through records.parse_jsonl. that keeps the upstream decoder as the single source
of truth and our code as a thin, defensive adapter.
"""
from __future__ import annotations

import subprocess
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from .. import config
from .. import records


class DecodeError(RuntimeError):
    """raised when the open_ring replay subprocess fails (carries its stderr)."""


def decode_capture(
    capture_path: str | Path,
    open_ring_dir: str | Path = config.OPEN_RING_DIR,
) -> Iterator[dict[str, Any]]:
    """replaying a capture through open_ring and yielding decoded records.

    shells out to `python -m driver.cli replay <capture_path>` with cwd set to
    open_ring_dir, streams its stdout line-by-line through records.parse_jsonl,
    and raises DecodeError (with the captured stderr) on a nonzero exit.

    yielding lazily so a huge capture never has to live in memory all at once.
    """
    capture_path = Path(capture_path)
    open_ring_dir = Path(open_ring_dir)

    # building the command up front so the error messages can quote it
    cmd = ["python", "-m", "driver.cli", "replay", str(capture_path)]

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(open_ring_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,  # line-buffered so we can stream stdout as it arrives
        )
    except (OSError, ValueError) as exc:
        # couldn't even launch — bad cwd, missing python, etc.
        raise DecodeError(f"could not start replay {cmd!r} in {open_ring_dir}: {exc}") from exc

    try:
        # streaming each decoded line out as the subprocess produces it
        if proc.stdout is not None:
            yield from records.parse_jsonl(proc.stdout)
    except Exception as exc:  # noqa: BLE001 — defensive: never leak a half-read pipe
        # killing the child so we don't orphan it on a consumer-side error
        try:
            proc.kill()
        except OSError:
            pass
        raise DecodeError(f"failed while streaming replay output: {exc}") from exc
    finally:
        # always drain/close so the child can exit and we can read its stderr
        try:
            if proc.stdout is not None:
                proc.stdout.close()
        except OSError:
            pass

    # waiting for the child and checking its exit code after stdout is exhausted
    try:
        stderr = proc.stderr.read() if proc.stderr is not None else ""
    except OSError:
        stderr = ""
    finally:
        try:
            if proc.stderr is not None:
                proc.stderr.close()
        except OSError:
            pass

    try:
        returncode = proc.wait(timeout=30)
    except subprocess.TimeoutExpired:
        try:
            proc.kill()
        except OSError:
            pass
        raise DecodeError(f"replay {cmd!r} did not exit in time")

    if returncode != 0:
        raise DecodeError(
            f"replay {cmd!r} exited {returncode}: {stderr.strip() or '<no stderr>'}"
        )


def decode_text(jsonl_text: str) -> Iterator[dict[str, Any]]:
    """parse-only helper: turning a blob of JSONL text into records.

    no subprocess — this is the pure path tests (and any in-process caller that
    already has the replay output) can exercise. malformed lines get skipped by
    records.parse_jsonl, same as the streaming path.
    """
    return records.parse_jsonl(jsonl_text.splitlines())
