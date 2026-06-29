"""central config — env-overridable so the Pi, a dev box, and the tests differ
only by environment, not by code. importing this is the one place paths and
tunables live. lives inside the package so 'from vitaldeck import config' (and
'from .. import config' from subpackages) resolves no matter the cwd."""
from __future__ import annotations

import os
from pathlib import Path

# this file sits at backend/vitaldeck/config.py
PACKAGE_DIR = Path(__file__).resolve().parent          # backend/vitaldeck
BACKEND_DIR = PACKAGE_DIR.parent                        # backend
REPO_DIR = BACKEND_DIR.parent                           # repo root

# where the sqlite db lives; tests point this at a throwaway temp file
DB_PATH = Path(os.environ.get("VITALDECK_DB", str(BACKEND_DIR / "vitaldeck.db")))

# open_ring lives here as a git submodule on the Pi; decode shells out to it.
# (we never vendor it from a dev machine — see docs/SETUP.md.)
OPEN_RING_DIR = Path(
    os.environ.get("VITALDECK_OPEN_RING", str(BACKEND_DIR / "vendor" / "open_ring"))
)

# adb-over-tailscale target for pulling the snoop log ("host:port" or a serial)
ADB_TARGET = os.environ.get("VITALDECK_ADB_TARGET", "")
ADB_BIN = os.environ.get("VITALDECK_ADB_BIN", "adb")

# scratch dir for bugreport zips + extracted btsnoop captures
CAPTURE_DIR = Path(os.environ.get("VITALDECK_CAPTURE_DIR", str(BACKEND_DIR / "captures")))

# the schema file the store layer applies on connect
SCHEMA_PATH = PACKAGE_DIR / "db" / "schema.sql"

# custom-readiness weights — must sum to 1.0; tune to taste. stored alongside
# every score so the number stays explainable.
READINESS_WEIGHTS = {
    "hrv": 0.40,
    "resting_hr": 0.25,
    "temp": 0.15,
    "sleep": 0.20,
}

# rolling personal-baseline windows, in days
BASELINE_WINDOWS = (14, 30)

# nightly sleep target used by the sleep subscore, in minutes (7.5h)
SLEEP_TARGET_MIN = 450

# local day rolls over at this UTC offset (hours). grouping records into "days"
# needs a timezone; default to the owner's and override per-deploy.
LOCAL_UTC_OFFSET_HOURS = float(os.environ.get("VITALDECK_UTC_OFFSET", "-5"))

API_HOST = os.environ.get("VITALDECK_API_HOST", "0.0.0.0")
API_PORT = int(os.environ.get("VITALDECK_API_PORT", "8000"))
