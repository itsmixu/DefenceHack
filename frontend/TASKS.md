# Frontend Tasks for Miko

This file describes everything the frontend needs to do.  
The backend is fully built and running on **http://localhost:8000** — you just need to wire it up.

---

## How to start the backend

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env        # fill in API keys
uvicorn app.main:app --reload --port 8000
```

Health check: `GET http://localhost:8000/api/health` → `{"status":"ok"}`

---

## Stack recommendation

- **React 18 + TypeScript + Vite** (port 5173)
- **MapLibre GL JS** for the map (open-source, no token required for basic use)
- **@mapbox/maplibre-gl-draw** (or `maplibre-gl-draw`) for drawing AOI/shapes
- **Zustand** for global state (layers, drawn features, plans)
- **TanStack Query** for data fetching + caching

Add a Vite proxy so `/api` requests hit the backend without CORS issues:

```ts
// vite.config.ts
server: {
  proxy: {
    '/api': 'http://localhost:8000'
  }
}
```

---

## API quick reference

All endpoints return JSON. Layer endpoints return GeoJSON FeatureCollections.  
Every response includes a `meta` object with `status` ("ok" / "unavailable" / "error") and `reason`.

### Sources
```
GET /api/sources
→ [{ id, name, description, bbox_required, tags, auth_required }, ...]
```

### Layers (GeoJSON)
```
GET /api/layers/{source}?bbox=west,south,east,north&t=ISO8601
```
Sources: `osm` `digiroad` `mml` `mml_contours` `statfin` `fmi` `opencellid` `n2yo` `exposure`

bbox example: `bbox=24.8,60.1,25.1,60.3`

### Analysis
```
GET /api/analyze/mcoo?bbox=...
→ GeoJSON FeatureCollection, each feature has properties.mcoo_class = "go" | "slow-go" | "no-go"

GET /api/analyze/terrain-effects?bbox=...
→ { summary, functions: { maneuver, fires, intelligence, sustainment, protection }, source_status }
   each function: { rating: "unrestricted"|"restricted"|"severely_restricted", rationale, key_factors }

GET /api/analyze/viewshed?bbox=...&observer_lon=&observer_lat=&observer_height_m=2.0
→ returns Table B-1 horizon circle polygon if observer given, else unavailable

GET /api/analyze/mobility?bbox=...&vehicle_class=tank|wheeled|tracked|logistics|foot
→ GeoJSON FC — every terrain polygon and road carries:
     speed_kmh       (0 = impassable)
     passable        (false on bridges below vehicle weight limit)
     mcoo_class      go | slow-go | no-go
     limiting_factor human-readable reason
     cite            ATP 2-41.1 Appendix B table reference
Colour the map green→yellow→red by speed_kmh (0=red, max road speed=green).

GET /api/analyze/drone-conditions?bbox=...
→ {
    summary: { current_rating: "go"|"marginal"|"no-go", station_count, next_go_window, forecast_hours_available },
    station_features: [ GeoJSON points with drone_rating per FMI station ],
    forecast_timeline: [ { time, drone_rating, wind_ms, temp_c, ceiling_m, cloud_cover_pct, ... } ],
    thresholds: { wind_no_go_ms: 12, ... }
  }

GET /api/analyze/astronomical?bbox=...&t=ISO8601
→ GeoJSON FC — 3 Point features (one per day) at bbox centroid, each with:
     date, sunrise, sunset, civil_dawn, civil_dusk
     moon_illumination_pct (0–100), moon_phase_days (0–29.5)
     night_ops_rating: "dark" | "partial" | "bright"
     darkness_hours
```

### FMI rain radar WMS (render directly in MapLibre — no backend call)
```
Tile URL (WMS):
https://openwms.fmi.fi/geoserver/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap
  &LAYERS=Radar:suomi_rr_eureffin
  &STYLES=&CRS=EPSG:3857&WIDTH=512&HEIGHT=512
  &FORMAT=image/png&TRANSPARENT=true
  &BBOX={west},{south},{east},{north}

Add as a MapLibre raster source using the {x}/{y}/{z} tile pattern via Vite proxy
or use the raw WMS URL with MapLibre's WMS source type. Renders live rain radar
blobs — refreshes every ~5 min from FMI.
```

### Plans (save map state between sessions)
```
POST   /api/plans           body: { name, bbox, drawn_features (GeoJSON FC), active_layers, notes, role }
GET    /api/plans           → list (drawn_features omitted for speed)
GET    /api/plans/{id}      → full plan with drawn_features
PUT    /api/plans/{id}      body: same as POST
DELETE /api/plans/{id}
```

### Operations (prediction vs reality)
```
POST /api/operations
body: {
  name, plan_id?,
  prediction: { notes, threat_assessment, expected_outcome },
  actual:      { notes, outcome },   ← leave empty at creation
  tags: []
}

GET  /api/operations?plan_id=...
GET  /api/operations/{id}
PATCH /api/operations/{id}/actual
body: { notes, outcome, recorded_at? }
```

---

## Feature types for drawn shapes

When the user draws shapes on the map, store them as GeoJSON features with:
```json
{ "properties": { "feature_type": "AOI" | "NAI" | "TAI" | "DP" | "annotation" } }
```

Colour convention (IPB doctrine):
- **AOI** — thick black border
- **NAI** (Named Area of Interest — intel collection target) — dashed blue
- **TAI** (Target Area of Interest — action zone) — dashed red
- **DP** (Decision Point) — diamond marker
- **annotation** — grey / freeform

---

## Task list

### Foundation

**Task 1 — Vite scaffold**  
Create the React + TypeScript + Vite project. Add dependencies: `maplibre-gl`, `@maplibre/maplibre-gl-draw`, `zustand`, `@tanstack/react-query`.

**Task 2 — Vite proxy**  
Configure `/api` → `http://localhost:8000` in `vite.config.ts` so all fetch calls use relative URLs.

**Task 3 — App shell**  
`App.tsx` renders a full-screen map on the left (~70% width) and a side panel on the right. Side panel has tabs: Layers, Analysis, Plans, Operations.

**Task 4 — MapView component**  
Initialise MapLibre map. Default centre on Finland (lon 25, lat 64, zoom 5). Expose map instance via a ref or Zustand store so other components can add/remove sources.

**Task 5 — BBox hook**  
`useBbox()` hook returns the current map viewport as `west,south,east,north` string. Debounce updates to 300 ms so layer fetches don't fire on every pixel of pan.

---

### Basemap & drawing

**Task 6 — MML WMTS basemap**  
Add the Finnish National Land Survey raster basemap as a MapLibre raster tile source.  
Tile URL template: `https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/maastokartta/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.png`  
(No API key needed for the public WMTS.)

**Task 7 — Draw toolbar**  
Add `maplibre-gl-draw` to the map. Toolbar buttons: polygon, line, point, select, delete.

**Task 8 — Feature type selector**  
When a shape is drawn, show a small popup/tooltip asking the user to classify it: AOI / NAI / TAI / DP / annotation. Write the choice to `feature.properties.feature_type`.

**Task 9 — drawnFeaturesStore**  
Zustand store that holds all drawn features as a GeoJSON FeatureCollection. Sync with the draw control's `draw.create` / `draw.update` / `draw.delete` events.

---

### Layer rendering (one component per source)

Each layer component:  
1. Calls `GET /api/layers/{source}?bbox=<current viewport>` (refetch on bbox change).  
2. Adds/updates a MapLibre source + layer when data arrives.  
3. Removes the layer when toggled off.  
4. Shows a loading spinner in the layer toggle while fetching.

**Task 10 — OSM layer**  
Source: `osm`. Properties include `category` (hospital / fuel / power_plant / power_substation).  
Render as circle markers; colour by category (red=hospital, orange=fuel, yellow=power).

**Task 11 — Digiroad layer**  
Source: `digiroad`. Road links (LineString). Properties: `road_class`, `is_bridge`.  
Render roads as thin grey lines; bridges as thicker blue lines.

**Task 12 — MML terrain layer**  
Source: `mml`. Terrain polygons. Properties: `terrain_type` (Jarvi, Suo, KallioAlue, etc.).  
Render as fill polygons; colour map: Jarvi=blue, Suo=brown, KallioAlue=grey, forest=green, field=yellow.

**Task 13 — MML contour lines layer**  
Source: `mml_contours`. Elevation contour lines. Properties: `elevation` (metres).  
Render as thin brown lines. Label every 10 m contour with the elevation value.

**Task 14 — StatFin Paavo layer**  
Source: `statfin`. Municipality polygons. Properties: `population`, `area_km2`, `postal_code`.  
Render as choropleth fill by population density (population / area_km2). Add click popup showing the stats.

**Task 15 — FMI weather layer**  
Source: `fmi`. Point features, one per weather station. Properties nested under `measurements`: `temperature`, `windspeedms`, `precipitation1h`.  
Render as circle markers. Click popup shows the measurements table.

**Task 16 — OpenCelliD layer (cell towers + coverage rings)**

Source: `opencellid`. Each tower produces **two features**:
- `category: "tower"` — Point at the tower location.
- `category: "coverage"` — Polygon (geodesic circle) showing estimated coverage radius.

Properties on both: `radio` (NR/LTE/UMTS/GSM), `radius_m`, `mcc`, `mnc`, `signal_strength`.

Coverage radii by technology (realistic field estimates for Finnish terrain):
| Radio | Radius  | Use                        |
|-------|---------|----------------------------|
| NR    | 1 km    | 5G urban small cell        |
| LTE   | 5 km    | 4G macro cell              |
| UMTS  | 8 km    | 3G                         |
| GSM   | 15 km   | 2G rural (can reach 35 km) |

**UI:**
- Tower Points: small antenna icon, colour by radio (5G=green, 4G=blue, 3G=yellow, 2G=grey).
- Coverage Polygons: low-opacity filled circles matching tower colour. Togglable separately from tower dots.
- Click tower → popup: radio type, estimated radius, MCC/MNC (operator), signal strength.
- Note in UI: "Coverage radius is an estimate based on radio type. Actual range varies with terrain and load."
- No real-time disabled-tower API exists; show all towers as "active" unless you want to add a manual override toggle.

**Task 17 — N2YO satellite layer (positions + footprint circles)**

Source: `n2yo`. Each satellite produces **two features**:
- `feature_type: "position"` — Point at the current sub-satellite point (ground track position).
- `feature_type: "footprint"` — Polygon (geodesic circle) showing the visibility horizon.

Key properties: `satname`, `satid`, `cospar_id`, `altitude_km`, `footprint_radius_km`, `category`.

Footprint = the area from which the satellite is above the horizon (elevation ≥ 0°).
A satellite at 500 km altitude has a ~2500 km footprint radius — this is the "is the satellite watching us?" boundary.

**UI:**
- Position Points: satellite icon. Colour by category: earth_observation=purple, weather=cyan.
- Footprint Polygons: very low opacity (5–10%) filled circle matching category colour. Togglable.
- Click satellite → popup: name, COSPAR ID, altitude, footprint radius, launch date.
- Add a legend note: "Footprint = visibility horizon. Imaging swath is narrower (sensor-dependent)."
- N2YO data is live (TLE updated continuously) — show a "fetched N min ago" indicator using the cache age.

**Task 18 — Exposure danger layer**  
Source: `exposure`. Polygon features. Properties: `danger_level` (1–5, lower = more cover).  
Render as fill polygons with a red gradient (1=light green → 5=dark red). This is the "danger zones" overlay.

---

### Headline IPB products

**Task 19 — MCOO overlay**  
Fetches `GET /api/analyze/mcoo?bbox=...`.  
Renders as a map fill layer with colours:  
- `go` → semi-transparent green  
- `slow-go` → semi-transparent yellow  
- `no-go` → semi-transparent red  
Toggle in the Layers panel alongside individual sources.

**Task 19b — SYKE flood / protected areas layer**  
Source: `syke`. Polygon features. Properties: `category` (flood_risk / protected_area), `mcoo_implication` (no-go / slow-go).  
Render flood_risk as semi-transparent blue fill with hatching. Protected areas as green outline only.  
These polygons override terrain colour in the mobility overlay when present.

**Task 19c — FMI HARMONIE forecast layer**  
Source: `fmi_forecast`. Point features at bbox centroid, one per hourly timestep.  
Render as a timeline chart in the side panel (not a map layer) — hour × condition grid showing cloud cover, precipitation rate, wind, and drone_rating colour.  
Also render current timestep as a coloured dot on the map at the centroid point.

**Task 19d — Rain radar WMS overlay**  
Add the FMI radar WMS tile layer (URL above in API reference) as a MapLibre raster source.  
Toggle in the Layers panel labelled "Live rain radar". Semi-transparent, refreshes every 5 minutes.  
No backend call needed — direct WMS from FMI.

**Task 20 — Terrain Effects Matrix card**  
Fetches `GET /api/analyze/terrain-effects?bbox=...`.  
Response now includes `mobility` (total_length_km, weighted_mech_speed_kmh, total_capacity_vph) and `weather` (environment_rating, aviation_rating) — display these as additional rows in the briefing card.  
Renders in the Analysis tab as a 5-row table:  
| Function | Rating | Rationale | Key factors |  
Colour-code ratings: unrestricted=green, restricted=amber, severely_restricted=red.  
Show `summary` at the top of the card. **This is a key judging criterion.**

---

### Dashboard & UX

**Task 21 — Layer toggle panel**  
Collapsible panel listing all 9 sources + MCOO + terrain-effects toggle.  
Each row: checkbox, source name, loading spinner / green dot / red dot based on `meta.status`.

**Task 22 — Source status panel (judging criterion)**  
A separate "Data sources" tab showing all sources from `GET /api/sources`.  
For each source: name, description, current status (fetched from the last layer response's `meta`), and a "Fetch now" button.  
**Judges specifically look for this transparency.**

**Task 23 — Time scrubber (use the timeline API below)**

The backend provides a dedicated timeline API so you only need **one request per scrub event** instead of N parallel layer requests.

#### Step 1 — on mount, fetch capabilities

```
GET /api/timeline/capabilities
```

Response:
```json
{
  "time_aware_sources": ["fmi", "osm", "astronomy", "statfin"],
  "snapshot_sources":   ["fmi", "osm", "astronomy"],
  "oldest_supported_date": "2007-10-08",
  "sources": {
    "fmi":       { "time_aware": true, "min_date": "2010-01-01", "resolution": "1h", "note": "..." },
    "osm":       { "time_aware": true, "min_date": "2007-10-08", "resolution": "1s", "note": "..." },
    "astronomy": { "time_aware": true, "min_date": "1900-01-01", "resolution": "1s", "note": "..." },
    "n2yo":      { "time_aware": false, "reason": "real-time only" },
    ...
  }
}
```

Use `oldest_supported_date` to set the scrubber's minimum date. Grey out layer toggles whose `time_aware === false` when a past date is selected — show the `reason` in a tooltip.

#### Step 2 — on each scrub event, call snapshot

```
GET /api/timeline/snapshot?bbox=WEST,SOUTH,EAST,NORTH&t=2024-01-15T12:00:00Z&sources=fmi,osm,astronomy
```

Response:
```json
{
  "t":    "2024-01-15T12:00:00.000000+00:00",
  "bbox": [24.5, 60.1, 25.5, 60.5],
  "layers": {
    "fmi":       { "type": "FeatureCollection", "features": [...], "meta": { "status": "ok" } },
    "osm":       { "type": "FeatureCollection", "features": [...], "meta": { "status": "ok" } },
    "astronomy": { "type": "FeatureCollection", "features": [...], "meta": { "status": "ok" } }
  },
  "source_status": { "fmi": "ok", "osm": "ok", "astronomy": "ok" },
  "meta": { "fetch_ms": 842, "sources_requested": ["fmi","osm","astronomy"], "sources_fetched": [...] }
}
```

Replace the live layer data with `layers[sourceId]` — one atomic update so all layers advance to the same `t`. Show `source_status` badges on each layer toggle. Show `meta.fetch_ms` as a "loaded in Xs" indicator.

#### Step 3 — UX

- Datetime picker + play/pause button + step ±1h buttons at the bottom of the screen.
- While fetching, show a loading spinner and disable the scrubber.
- When `t` is "now" (cleared), revert to the normal per-layer fetches from `/api/layers/{source}`.
- `fmi_forecast` layer: hide automatically when `t` is in the past (check `time_aware === false` in capabilities, or `source_status[src] === "unavailable"`).
- Debounce scrubber drag to ~300 ms before firing the snapshot request.

---

### Planning & history

> **API client functions are already written** — import from `src/api/client.ts`:
> `listPlans`, `getPlan`, `createPlan`, `updatePlan`, `deletePlan`,
> `listPlanVersions`, `getPlanVersion`, `createPlanVersion`
> Types are in `src/api/types.ts`: `Plan`, `PlanSummary`, `PlanVersion`, `PlanVersionSummary`.

---

**Task 24 — Plans tab in the side panel**

Add a fourth tab "Plans" to `SidePanel.tsx` (after "Drawn"). The tab has two sections: **Save** and **Browse**.

#### Section A — Save current state

Two buttons side by side:

**"Save plan"** — prompts for a plan name, then:
```typescript
import { createPlan } from '../api/client';
import { useDrawnStore, useBboxStore, useLayerStore } from '../store';

const drawn = useDrawnStore.getState().features;   // GeoJSON FeatureCollection
const bbox  = useBboxStore.getState().bbox;         // [w,s,e,n]
const active = Object.keys(useLayerStore.getState().active)
                 .filter(k => useLayerStore.getState().active[k]);

const plan = await createPlan({ name, bbox, drawn_features: {type:'FeatureCollection',features:drawn}, active_layers: active });
// store plan.id in local state so "Save version" knows which plan to attach to
```

**"Save version"** (only enabled after a plan exists) — prompts for a label like "Initial planning" / "After recon" / "Final approved", then:
```typescript
import { createPlanVersion } from '../api/client';

await createPlanVersion(currentPlanId, {
  label,
  role: currentRole,   // from role selector (Task 29), or default "commander"
  bbox,
  drawn_features: { type: 'FeatureCollection', features: drawn },
  active_layers: active,
  notes: currentNotes,
  // optional: pass last fetched layer responses here for conditions context
});
```

Suggested label presets to show as quick-pick buttons: `Initial planning` / `After recon` / `Commander review` / `Final approved`.

#### Section B — Browse saved plans

```typescript
import { listPlans, getPlan, deletePlan } from '../api/client';
```

Render as a list. Each row shows: plan name + date. Two buttons: **Load** and **Delete**.

**Load** calls `getPlan(id)` and restores:
- `useDrawnStore.setState({ features: plan.drawn_features.features })`
- `useLayerStore` — toggle layers to match `plan.active_layers`
- Fly map to `plan.bbox` if set

Below each plan row, a collapsible **"Versions (N)"** expander.

#### Section C — Version viewer (inside the expander)

```typescript
import { listPlanVersions, getPlanVersion } from '../api/client';
```

List versions oldest-first. Each row: `[version number] label — role — timestamp`.

Click a version row → load that snapshot the same way as a plan load. Show a visual "viewing version N of M" banner at the top of the map so it's clear the user is in history mode, not live editing. Add an **"Exit history mode"** button that restores the pre-history live state.

**Diff indicator between adjacent versions:** count `drawn_features.features.length` difference and show `+2 shapes / -1 shape` between rows.

**Task 25 — (merged into Task 24 Section B above)**

**Task 26 — New operation flow**  
Form to create an operation:  
1. Link to an existing plan (optional).  
2. Fill in prediction: notes, threat assessment, expected outcome.  
3. POST to `/api/operations`.

**Task 27 — History view (prediction vs reality)**  
List of operations from `GET /api/operations`. For each operation show:  
- Prediction fields (recorded before).  
- Actual fields (recorded after — edit via PATCH `/api/operations/{id}/actual`).  
- Side-by-side diff view so teams can see what they got right/wrong.  
**This is the "predictions vs real life" feature from the whiteboard — a key differentiator.**

---

### Polish

**Task 21b — Mobility overlay**  
Fetches `GET /api/analyze/mobility?bbox=...&vehicle_class=<selected>`.  
Vehicle class selector: dropdown with Tank / Tracked IFV / Wheeled APC / Logistics / Foot.  
Render as fill layer on the map coloured by `speed_kmh`:  
  0 km/h → red (impassable), 1–10 → orange, 11–25 → yellow, >25 → green.  
Show `limiting_factor` in a click popup. Show `passable: false` bridges as red crosshatched lines.  
Togglable in the Layers panel, separate from MCOO.

**Task 21c — Drone conditions panel**

Fetches `GET /api/analyze/drone-conditions?bbox=...` (no API key needed — uses FMI data).

Response shape (key fields):
```json
{
  "summary": {
    "current_rating": "go" | "marginal" | "no-go",
    "next_go_window": "2025-06-01T14:00:00Z",
    "station_count": 4,
    "forecast_hours_available": 48
  },
  "station_features": [
    {
      "geometry": { "type": "Point", ... },
      "properties": {
        "drone_rating": "marginal",
        "drone_summary": "Marginal: wind 9 m/s near limit",
        "limiting_factors": ["wind speed 9.0 m/s (marginal ≥8 m/s)"],
        "measurements": { "wind_ms": 9.0, "temp_c": 4.0, "visibility_m": 8000, "precip_mmh": 0 }
      }
    }
  ],
  "forecast_timeline": [
    { "time": "2025-06-01T14:00:00Z", "drone_rating": "go", "wind_ms": 3.0, "temp_c": 8.0, ... }
  ],
  "thresholds": { "wind_marginal_ms": 8.0, "wind_no_go_ms": 12.0, ... }
}
```

**UI:**
- "Traffic light" header badge: green=go / amber=marginal / red=no-go. Show `summary.current_rating`.
- Per-station map dots coloured by `drone_rating`. Click → popup with `measurements` + `limiting_factors`.
- 48-hour forecast bar chart: each hour = one bar, coloured go/marginal/no-go. X-axis = time, Y-axis = wind speed.
- Show `summary.next_go_window` as "Next launch window: HH:MM — DD MMM".
- Show the three key thresholds from `thresholds`: wind no-go, temperature cold no-go, visibility no-go.
- Limiting factor examples to display in plain language:
  - `wind speed X m/s (marginal ≥8 m/s)` → "Too windy (X m/s)"
  - `temperature X°C (no-go ≤-15°C)`      → "Too cold (X°C)"
  - `precipitation X mm/h (marginal ≥2)`   → "Too rainy (X mm/h)"

**Task 21d — Astronomical / night ops panel**  
Fetches `GET /api/analyze/astronomical?bbox=...`.  
Shows a 3-day card in the Analysis tab:  
  Each day: sunrise icon / sunset icon / moon phase icon + illumination %.  
  Colour-coded `night_ops_rating`: dark=black background / partial=dark blue / bright=grey-blue.  
Show civil dawn/dusk times since these bound optical observation windows.

**Task 28 — Hillshade / terrain overlay**  
Add a MapLibre terrain-exaggeration layer using the MML DEM tiles for a 3-D hillshade effect.  
Tile URL: `https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/maastovarjo/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.png`

**Task 29 — Role selector**  
Dropdown in the toolbar: Soldier / Medic / Commander / Observer.  
Different roles see different default layers:  
- Soldier: terrain, exposure, MCOO  
- Medic: OSM (hospitals), roads, weather  
- Commander: all layers on, terrain effects matrix open  
- Observer: satellite, cell coverage, weather  
The selected role is passed as `role` when saving plans.

**Task 30 — Legend**  
Floating legend card on the map showing colour keys for whichever layers are currently active.  
Auto-updates when layers are toggled. Collapsible.

---

## Notes for Miko's agent

- The backend degrades gracefully: if a source is unavailable it returns HTTP 200 with an empty `features: []` array and `meta.status = "unavailable"`. Never show errors to the user — just hide the layer quietly and show a grey dot in the status panel.
- All coordinates are EPSG:4326 (standard longitude/latitude). No reprojection needed on the frontend.
- bbox format is always `west,south,east,north` as a comma-separated query param.
- The backend file-cache lives in `data/cache/` (gitignored). Plans and operations live in `data/plans/` and `data/operations/` (also gitignored). Nothing to worry about on the frontend.
- Drawn features use GeoJSON Feature objects. The `properties.feature_type` field is what the backend saves and returns.
