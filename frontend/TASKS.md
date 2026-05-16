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

GET /api/analyze/viewshed?bbox=...&observer_lon=&observer_lat=
→ stub — always returns empty FC with meta.status="unavailable"
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

**Task 16 — OpenCelliD layer**  
Source: `opencellid`. Mix of Point (towers) and Polygon (coverage rings).  
Render tower points as small antenna icons; coverage polygons as low-opacity blue fills.

**Task 17 — N2YO satellite layer**  
Source: `n2yo`. Point features. Properties: `name`, `category` (earth_observation / weather / other), `altitude_km`.  
Render as moving dots (or static at fetch time). Category colours: EO=purple, weather=cyan, other=grey.

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

**Task 20 — Terrain Effects Matrix card**  
Fetches `GET /api/analyze/terrain-effects?bbox=...`.  
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

**Task 23 — Time scrubber**  
Datetime picker at the bottom of the screen. When set, appends `?t=<ISO8601>` to all layer and analysis fetches. Lets users replay historical weather / satellite positions.

---

### Planning & history

**Task 24 — Save plan button**  
In the side panel, "Save plan" button that POSTs to `/api/plans` with the current bbox, drawn features (from drawnFeaturesStore), active layers, and a user-provided name. Show success toast.

**Task 25 — Saved plans sidebar**  
List of saved plans from `GET /api/plans`. Click a plan to restore bbox, drawn features, and active layers. Delete button per row.

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
