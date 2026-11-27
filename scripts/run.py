"""Start CareTrace: API on :8000 and (if present) the Vite UI on :5173.

    python scripts/run.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))          # make `backend` importable


def main() -> None:
    procs: list[subprocess.Popen] = []
    frontend = ROOT / "frontend"
    npm = shutil.which("npm")
    if (frontend / "package.json").exists() and npm:
        procs.append(subprocess.Popen([npm, "run", "dev"], cwd=frontend))
        print("UI  -> http://localhost:5173")
    else:
        print("UI  -> frontend not built yet (Phase 4); API only")

    print("API -> http://127.0.0.1:8000  (docs at /docs)")
    import uvicorn

    try:
        uvicorn.run("backend.app.main:app", host="127.0.0.1", port=8000,
                    log_level="warning")
    finally:
        for p in procs:
            p.terminate()


if __name__ == "__main__":
    sys.exit(main())
