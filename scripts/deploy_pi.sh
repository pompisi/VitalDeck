#!/usr/bin/env bash
# one-shot Raspberry Pi bring-up for the VitalDeck backend.
# clones open_ring, builds the venv, installs deps, runs the tests, proves the
# pipeline on synthetic data, and prints how to start the API. safe to re-run.
#
# usage (on the Pi, after `git clone`ing this repo):
#   bash scripts/deploy_pi.sh
set -euo pipefail

# locating the repo from this script's own path so it runs from anywhere
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$REPO_DIR/backend"
OPEN_RING="$BACKEND/vendor/open_ring"

echo "==> VitalDeck Pi setup — repo at $REPO_DIR"

command -v python3 >/dev/null || { echo "python3 not found — install it first"; exit 1; }
command -v git >/dev/null || { echo "git not found — install it first"; exit 1; }

# 1. vendor open_ring (the GPLv3 decoder we shell out to; never committed here)
if [ ! -d "$OPEN_RING/.git" ]; then
  echo "==> cloning open_ring into vendor/"
  git clone --depth 1 https://github.com/LogosIsLife/open_ring "$OPEN_RING"
else
  echo "==> open_ring already present; fast-forwarding"
  git -C "$OPEN_RING" pull --ff-only || true
fi

# 2. virtualenv + deps
cd "$BACKEND"
if [ ! -d .venv ]; then
  echo "==> creating venv"
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
echo "==> installing deps"
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

# 3. run the tests so a broken checkout fails loudly here, not at runtime
echo "==> running tests"
python -m pytest tests -q

# 4. prove the whole pipeline end-to-end on synthetic data (no ring needed)
echo "==> seeding synthetic data (pipeline proof)"
python -m tools.seed --days 14

# 5. next steps
cat <<EOF

==> setup complete.

start the API (reachable over LAN + Tailscale):
  cd "$BACKEND" && source .venv/bin/activate
  uvicorn vitaldeck.api.main:app --host 0.0.0.0 --port 8000

point the phone app at this Pi with:
  EXPO_PUBLIC_API_URL=http://<this-pi-tailscale-name-or-ip>:8000

to keep it running on boot, see docs/SETUP.md (systemd unit).
for REAL ring data, set VITALDECK_ADB_TARGET and follow docs/PHASE0_RUNBOOK.md.
EOF
