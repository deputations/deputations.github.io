#!/usr/bin/env bash
# One-liner to run the smoke suite locally (P3-4).
#
# Creates .venv-smoke, installs requirements, installs Chromium, runs pytest.
# Pass extra pytest args after the script name, e.g.:
#   bash scripts/run_smoke.sh tests/test_index.py -k test_modal -v
#
# CI does not use this script — .github/workflows/smoke-tests.yml calls pytest
# directly against the runner's own Python. This is purely a local helper.
set -euo pipefail

cd "$(dirname "$0")/.."

python -m venv .venv-smoke

# venv binary layout is platform-dependent: POSIX uses bin/, Windows uses
# Scripts/ with .exe. This repo is normally driven from Git Bash on Windows,
# where the hardcoded bin/ path failed on the very first line.
if [ -x ".venv-smoke/bin/python" ]; then
  VENV_PY=".venv-smoke/bin/python"
else
  VENV_PY=".venv-smoke/Scripts/python.exe"
fi

"$VENV_PY" -m pip install --upgrade pip
"$VENV_PY" -m pip install -r scripts/requirements.txt

# --with-deps apt-installs system libraries; it only works on Linux and fails
# the whole run elsewhere.
if [ "$(uname -s)" = "Linux" ]; then
  "$VENV_PY" -m playwright install --with-deps chromium
else
  "$VENV_PY" -m playwright install chromium
fi

# Default to the whole suite. Args replace that target rather than being
# appended to it — the previous form hardcoded `tests/` and then added "$@",
# so the documented `run_smoke.sh tests/test_index.py` ran BOTH and quietly
# executed everything.
if [ "$#" -eq 0 ]; then
  set -- tests/
fi

exec "$VENV_PY" -m pytest -v --tb=short "$@"
