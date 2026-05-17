#!/usr/bin/env bash
# Capture a complete API snapshot of one AO for the offline / hosted demo mode.
#
# The result lands in frontend/public/demo/ and is served statically by Vite
# (or any static host). The frontend's demo-mode fetch interceptor maps live
# /api/... calls to these files when the page is opened with `?demo=1`.
#
# Usage:
#   ./scripts/capture-demo-snapshot.sh
#
# Requires: the backend running on http://localhost:8000.

set -euo pipefail

BACKEND="${BACKEND:-http://localhost:8000}"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/frontend/public/demo"

# ── Fixed demo area: central Joensuu ─────────────────────────────────────────
# Mentioned by name in the challenge brief. Tight bbox so:
#  - OpenCelliD's 9-tile fan-out cap is respected
#  - OSM Overpass query stays under its size limit
#  - mml / mml_contours / exposure / mcoo polygons stay in the low MB range
BBOX="29.69,62.57,29.82,62.63"
T_NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

mkdir -p "$OUT_DIR/layers" "$OUT_DIR/analyze"

echo "Capturing demo snapshot → $OUT_DIR"
echo "  bbox=$BBOX"
echo "  t=$T_NOW"

fetch() {
  local url="$1"
  local out="$2"
  echo "  → $out"
  if ! curl -fsS "$BACKEND$url" -o "$out"; then
    echo "    !! failed: $url" >&2
    # Write an empty FeatureCollection so the frontend gracefully shows
    # 'unavailable' rather than hard-erroring.
    printf '{"type":"FeatureCollection","features":[],"meta":{"status":"unavailable","reason":"demo snapshot capture failed"}}\n' > "$out"
  fi
}

# Top-level
fetch "/api/sources"                                                    "$OUT_DIR/sources.json"
fetch "/api/timeline/capabilities"                                      "$OUT_DIR/timeline-capabilities.json"

# Layers
for L in osm digiroad mml mml_contours statfin fmi fmi_forecast syke opencellid starlink astronomy exposure; do
  fetch "/api/layers/$L?bbox=$BBOX&t=$T_NOW" "$OUT_DIR/layers/$L.json"
done

# MCOO lives under /api/analyze
fetch "/api/analyze/mcoo?bbox=$BBOX&t=$T_NOW"                           "$OUT_DIR/layers/mcoo.json"

# Briefing analyses
fetch "/api/analyze/terrain-effects?bbox=$BBOX&t=$T_NOW"                "$OUT_DIR/analyze/terrain-effects.json"
fetch "/api/analyze/drone-conditions?bbox=$BBOX&t=$T_NOW"               "$OUT_DIR/analyze/drone-conditions.json"
fetch "/api/analyze/astronomical?bbox=$BBOX&t=$T_NOW"                   "$OUT_DIR/analyze/astronomical.json"

# Manifest — read by the frontend banner so the user sees what they're looking at
cat > "$OUT_DIR/manifest.json" <<EOF
{
  "bbox": [29.69, 62.57, 29.82, 62.63],
  "center": [62.60, 29.76],
  "zoom": 13,
  "captured_at": "$T_NOW",
  "area_label": "Joensuu, Finland"
}
EOF
echo "  → $OUT_DIR/manifest.json"

echo "Done. Open http://localhost:5173/?demo=1"
