#!/usr/bin/env bash
# One-liner to run the smoke suite locally (P3-4).
#
# Creates .venv-smoke, installs requirements, installs Chromium, runs pytest.
# Pass extra pytest args after the script name, e.g.:
#   bash scripts/run_smoke.sh tests/test_index.py -k test_modal -v
set -euo pipefail

cd "$(dirname "$0")/.."

python -m venv .venv-smoke
.venv-smoke/bin/pip install --upgrade pip
.venv-smoke/bin/pip install -r scripts/requirements.txt
.venv-smoke/bin/python -m playwright install --with-deps chromium

exec .venv-smoke/bin/python -m pytest tests/ -v --tb=short "$@"
