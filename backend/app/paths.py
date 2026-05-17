"""Filesystem roots for cached and persisted data.

Defaults to `data/` at the repo root (two levels up from this file), so local
development keeps working with no env vars. Override with `DATA_ROOT` in
production — on Fly we mount a volume at `/data` and point this there.
"""
from __future__ import annotations

import os
from pathlib import Path

DATA_ROOT = Path(os.getenv("DATA_ROOT") or (Path(__file__).resolve().parents[2] / "data"))
