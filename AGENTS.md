

# AGENTS.md — DefenceHack / 61N IPB Tool

> **Read this file first.** It is the single source of truth for any AI coding
> agent (Cascade, Claude Code, Cursor, Copilot, etc.) or human contributor
> working on this repository. If you change architecture, update this file in
> the same commit.

---

## 0. AI agent roles (read this before §1)

Two AI agents run simultaneously on the **frontend** side of this repo.
Each agent has a strict ownership boundary. Violating it causes merge
conflicts. Do not touch files outside your zone without an explicit
human instruction.

### Windsurf (Cascade) — Map zone

**Owns:** `frontend/src/map/`, `frontend/src/drawing/`

**Primary tasks:**
- `MapView.tsx` — Leaflet container, zoom/pan, basemap switching
- `frontend/src/map/layers/` — one component per data layer (roads,
  weather, population, cell towers, satellite, exposure, MCOO overlay)
- `frontend/src/drawing/` — geoman setup, drawn-feature store, feature
  type styling (`AOI`, `NAI`, `TAI`, `DP`, `annotation`)
- Basemap configs (`basemaps.ts`) and MML WMTS tile integration
- Layer toggle panel (the UI control that turns layers on/off)

**Do NOT touch:**
- `frontend/src/dashboard/` — that is Claude Code's zone
- `backend/` — ever, unless human says so

---

### Claude Code — Dashboard zone

**Owns:** `frontend/src/dashboard/`, `frontend/src/api/`

**Primary tasks:**
- `frontend/src/dashboard/` — side panel, all stat widgets, weather
  summary card, satellite overpass schedule, source-status panel,
  terrain-effects briefing card, plans/operations history view
- `frontend/src/api/` — typed `fetch` clients for every backend
  endpoint (layers, `/api/sources`, `/api/plans`, `/api/operations`,
  `/api/analyze/*`)
- Time/date picker and AOI search bar (they feed data into the
  dashboard, not the map)
- Any cross-cutting state (Zustand store if added) lives in
  `frontend/src/lib/` — coordinate with Windsurf before adding

**Do NOT touch:**
- `frontend/src/map/` — that is Windsurf's zone
- `frontend/src/drawing/` — that is Windsurf's zone
- `backend/` — ever, unless human says so

---

### Shared / neutral files

Both agents may read but must **coordinate before writing**:

| File | Who writes | Rule |
|---|---|---|
| `frontend/src/App.tsx` | Either | Discuss first; keep changes minimal |
| `frontend/src/main.tsx` | Either | Rarely needs touching |
| `frontend/src/lib/` | Either | Add utils freely; do not rename existing exports |
| `frontend/package.json` | Either | Add deps in separate commits, note why |
| `AGENTS.md` | Either | Update in same commit as the change it documents |

---

### Handshake: how the two zones talk

The map and dashboard are decoupled through **shared state only** —
no direct component imports across the zone boundary.

- Windsurf fires events / updates a Zustand slice (e.g. `mapSlice`)
  when the visible bbox changes or a drawing is completed.
- Claude Code reads from that slice in the dashboard; it never imports
  a component from `map/` or `drawing/`.
- Conversely, Windsurf reads from `dashboardSlice` (e.g. active layers,
  selected time) but never imports from `dashboard/`.
- The `api/` clients (Claude Code's zone) are imported by both sides —
  that is intentional and fine.

---

## 1. Project context

This repository is our entry for the **Junction Defence Hackathon — 61N
Challenge**: *Automate intelligence preparation of the battlefield (IPB)
using open-source data*.

The deliverable is a **web tool** that, given a geographic area and timeframe,
automatically retrieves, processes and visualises operationally relevant
open-source data (terrain, weather, infrastructure, demographics, satellite
overpasses, etc.) so a planning team can rapidly understand an operational
environment.

The full challenge brief lives in `challenge.md` at the repo root. Re-read it
before making any non-trivial design decision.

### Target areas (exemplary, not exclusive)

1. Archipelago Sea (Saaristomeri)
2. North Karelia (Pohjois-Karjala)
3. Käsivarren Lappi (Lapland)

The solution **must generalise to any area in the world**. The UI must also
**transparently indicate which data sources were available and which were
not** for a given area — this is an explicit judging criterion.

### What the user sees

- A full-screen **interactive 2D map** of the chosen Area of Interest (AOI).
- A **layer panel** to toggle data layers (roads, bridges, cell towers,
  population, weather, etc.).
- **Drawing tools** to sketch routes, danger zones, range rings, markers and
  arbitrary polygons on top of the map.
- A **side dashboard** with statistics, weather summaries, satellite overpass
  schedules, and a list of which sources succeeded / failed.
- A **time/date picker** for the timeframe (relevant for weather, satellite
  passes, historical statistics).

---

## 2. Team & ownership split

Two contributors, two computers, two AI agents. Strict separation of concerns,
joined only by a **GeoJSON-over-HTTP contract**.

| Area | Owner | Stack |
|---|---|---|
| **Backend** — data fetching, processing, GeoJSON API | Teammate | Python 3.11+, FastAPI, GeoPandas |
| **Frontend** — interactive map, drawing, dashboard | Miko | TypeScript, React, Vite, Leaflet |

Neither side may reach into the other's folder without coordinating. The
**only** integration point is the HTTP API documented in §6.

---

## 3. Tech stack (locked-in choices)

### Frontend (`frontend/`)

- **Build / framework**: Vite + React 18 + TypeScript.
- **Map library**: **Leaflet** via **react-leaflet**.
  - Chosen over MapLibre/OpenLayers for hackathon velocity. Drawing,
    clustering, heatmaps and WMTS basemaps are all one-line plugins.
- **Drawing**: `@geoman-io/leaflet-geoman-free` (polygons, polylines,
  markers, circles, edit/delete, snapping).
- **Clustering**: `leaflet.markercluster` (cell towers, POIs).
- **Heatmaps**: `leaflet.heat` (population density fallback).
- **Styling / UI**: Tailwind CSS + shadcn/ui for the dashboard side panel and
  controls. Lucide for icons.
- **State**: React local state + Zustand if/when global layer state grows.
  Do not add Redux.
- **HTTP**: native `fetch` or `ky`. Do not add Axios.

### Backend (`backend/`)

- **Language**: Python 3.11+.
- **Framework**: FastAPI + Uvicorn (ASGI).
- **Models**: Pydantic v2 for response schemas.
- **HTTP client**: `httpx` (async) for upstream provider calls.
- **Geo libs** (added per-provider as needed): GeoPandas, Shapely, pyproj for
  reprojecting Finnish authority data from EPSG:3067 → EPSG:4326. `fmiopendata`
  for FMI.
- **Config**: `python-dotenv` loads `backend/.env`. `.env.example` is committed.
- **Run command**: `uvicorn app.main:app --reload --port 8000` (from `backend/`).
- **Port**: `8000`. The frontend Vite dev server proxies `/api` here.
- **Layout**: `backend/app/{main.py, routers/, providers/, schemas.py, bbox.py,
  registry.py, cache.py, geo.py}`. Providers added incrementally per §7.
- **Hard requirements**:
  - GeoJSON `FeatureCollection` in EPSG:4326 on every layer endpoint.
  - API keys from env vars only — never hard-coded.
  - Upstream responses cached under `data/cache/` for demo resilience.
  - No database in v1; files on disk only.

### Shared

- **Data interchange**: **GeoJSON `FeatureCollection`** in **EPSG:4326**
  (WGS84, lon/lat). Any other CRS is a bug.
- **Time**: ISO 8601, UTC, with `Z` suffix.
- **Bounding boxes**: `minLon,minLat,maxLon,maxLat` as a single comma-separated
  query string parameter named `bbox`.

---

## 4. Repository layout

```
DefenceHack/
├── AGENTS.md                  # ← you are here
├── challenge.md               # original challenge brief from 61N
├── README.md                  # human-facing readme (run/build instructions)
│
├── backend/                   # Python service (teammate)
│   └── README.md              # internal layout decided by backend owner
│
├── frontend/                  # React app (Miko)
│   ├── README.md
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api/               # typed clients for backend endpoints  [Claude Code]
│       ├── map/               # [Windsurf]
│       │   ├── MapView.tsx    # main Leaflet container
│       │   ├── basemaps.ts    # OSM, MML WMTS configs
│       │   └── layers/        # one component per layer type
│       ├── drawing/           # geoman setup, drawn-features store   [Windsurf]
│       ├── dashboard/         # side panel, stats widgets            [Claude Code]
│       └── lib/               # shared utils (bbox, geojson helpers) [both]
│
└── data/                      # gitignored cached / downloaded data
    ├── README.md
    ├── cache/                 # backend response cache
    └── raw/                   # one-off downloads (Digiroad GeoPackage, etc.)
```

`data/cache/`, `data/raw/`, `data/plans/`, and `data/operations/` are all
**gitignored**. Never commit downloaded datasets, API keys, generated
GeoJSON, or saved plans/operation records.

---

## 5. Conventions

### CRS handling (read this twice)

- Many Finnish datasets ship in **EPSG:3067** (ETRS-TM35FIN). MML elevation
  rasters too.
- The web map is **EPSG:4326** (or technically 3857 for tiles, but Leaflet
  hides this).
- **Reproject in the backend, never in the frontend.** Every endpoint returns
  EPSG:4326 GeoJSON. Period.
- The backend is expected to provide internal helpers for reprojection and
  bbox handling; the exact module path is the backend owner's call.

### API endpoint shape

```
GET /api/layers/<source>?bbox=<minLon,minLat,maxLon,maxLat>&t=<ISO8601>
```

- Always returns `application/geo+json` with a `FeatureCollection`.
- Each `Feature.properties` includes a `source` field (e.g. `"digiroad"`)
  and any source-specific attributes (road class, bridge load, etc.).
- On upstream failure: return **HTTP 200** with an empty
  `FeatureCollection` and a `meta.status = "unavailable"` field, plus
  `meta.reason`. The UI must show this transparently — do **not** silently
  swallow failures.

Source availability is also reported via:

```
GET /api/sources
```

→ returns a list of `{ id, label, status: "ok"|"degraded"|"unavailable",
last_checked, reason? }`.

### Frontend layer contract

Every layer component takes `{ bbox, time }` and renders itself when
toggled. Drawn shapes are persisted by POSTing to `/api/plans` (see
§Planning & operations API below).

### Planning & operations API

These endpoints support the "history past / predictions vs real life"
feature from the project whiteboard. No GeoJSON — plain JSON.

**Plans** — saved map states (drawn shapes + active layers + notes):
```
POST   /api/plans          body: { name, bbox, drawn_features, active_layers, notes, role? }
GET    /api/plans          → list (drawn_features omitted for brevity)
GET    /api/plans/{id}     → full plan including drawn_features
PUT    /api/plans/{id}     body: same as POST — replaces the plan
DELETE /api/plans/{id}
```

`drawn_features` is a GeoJSON FeatureCollection of whatever the user
drew with geoman. `active_layers` is an array of source IDs
(e.g. `["mml", "mml_contours", "exposure", "digiroad"]`).

**Operations** — prediction + actual outcome records:
```
POST   /api/operations               body: { name, plan_id?, bbox,
                                             prediction: { notes, threat_assessment, expected_outcome },
                                             tags? }
GET    /api/operations?plan_id=…     → list all (or filter by plan)
GET    /api/operations/{id}
PATCH  /api/operations/{id}/actual   body: { notes, outcome, recorded_at? }
```

Workflow: before the op create a record with `prediction` filled in;
after it completes PATCH `/actual` with what really happened. The
history view diffs the two.

Storage: JSON files under `data/plans/` and `data/operations/`
(gitignored, local to the demo machine). No database required.

### Computed / derived layers

Layers that are not raw data feeds but server-side computations:

**`mml_contours`** — elevation contour lines from MML Maastotietokanta
WFS (feature type `Korkeusviiva`). Each LineString has `elevation_m`
and `contour_type` ("index" every 25 m, "intermediate" every 5 m).
Override feature type name with `MML_LAYER_CONTOUR` env var.

**`exposure`** — terrain danger-zone scoring. Combines MML terrain
polygons and OSM land-use data to assign a `danger_level` (1 = safe /
hard cover, 5 = fully exposed) and `reason` string to every feature.
Render as a green-to-red choropleth. Answers "what forces can do and
what is possible" from the project goals. MML terrain is skipped if
`MML_API_KEY` is absent (OSM land-use still runs).

### IPB analysis endpoints (`/api/analyze/...`)

Doctrinal IPB products that fuse multiple raw layers. These are the
headline outputs that map directly to the 61N source material on IPB.

All analysis ratings are grounded in **ATP 2-41.1 (2021) Appendix B —
"Hard numerical thresholds for AI model training."** The thresholds are
centralised in `backend/app/doctrine.py` and every classification carries
back the specific table reference (B-1 … B-17) that justified it, so
judges can audit any colour on the map by reading `mcoo_cite` /
`functions.<x>.cite`. Pinned by `tests/test_doctrine.py`.

**`GET /api/analyze/mcoo?bbox=…&t=…`** — Modified Combined Obstacle
Overlay. Per doctrine "the primary terrain analysis output product".
Returns a GeoJSON FeatureCollection where every feature carries:
  - `mcoo_class`: `"go"` | `"slow-go"` | `"no-go"`
  - `mcoo_role`: `"terrain"` | `"mobility_corridor"` | `"chokepoint_bridge"`
  - `mcoo_cite`: ATP 2-41.1 Appendix B table reference, e.g. `"B-2"`, `"B-16"`
  - `mcoo_reason`: one-line rationale naming the doctrinal threshold applied
  - `doctrine`: `"ATP 2-41.1 Appendix B"`
The FeatureCollection `meta.attribution` is set to
`"Classification per ATP 2-41.1 (2021) Appendix B"` so the legend can
display the citation. Frontend renders as the primary tactical overlay
(green / yellow / red, with bridges highlighted as chokepoints).

**`GET /api/analyze/terrain-effects?bbox=…&t=…`** — Terrain Effects
Matrix. Structured JSON (not GeoJSON) rating each warfighting function:
`maneuver`, `fires`, `intelligence`, `sustainment`, `protection`. Each
has a `rating` (unrestricted / restricted / severely_restricted),
`cite` (Appendix B table reference), `rationale` string, and
`key_factors` list. The response also returns:
  - `mobility`: weighted mech road speed, total network capacity (vph,
    Table B-17), bridge count, flow-class breakdown.
  - `terrain_composition`: % go / slow-go / no-go area share.
  - `weather`: avg temp / wind, plus `environment_rating` and
    `aviation_rating` derived from Table B-12.
Frontend renders as a side-panel briefing card.

**`GET /api/analyze/viewshed?bbox=…&observer_lon=&observer_lat=&observer_height_m=`** —
Line-of-sight / dead-ground analysis. True viewshed needs the MML 2 m
DEM raster pipeline (`rasterio` + GeoTIFF), still to be built. As a
fallback the endpoint returns the **Table B-1 geometric horizon** (d =
3.57·√h km) as a circular polygon around the observer so the frontend
has something to render and the doctrinal formula is visible.
`meta.status = "partial"` when fallback is returned, `"unavailable"`
when no observer point is supplied.

### Drawn-feature types in plans

Each feature in a plan's `drawn_features` FeatureCollection should
carry `properties.feature_type` from this doctrinal set so Miko can
style them correctly:

  - `"AOI"` — Area of Operations / Area of Interest boundary
  - `"NAI"` — Named Area of Interest (intelligence collection target)
  - `"TAI"` — Target Area of Interest (action / engagement zone)
  - `"DP"`  — Decision Point (condition-triggered branch on the map)
  - `"annotation"` — freeform note shape, no doctrinal meaning

### Naming

- Source IDs are lowercase, no spaces: `mml`, `mml_contours`, `fmi`,
  `digiroad`, `statfin`, `opencellid`, `n2yo`, `osm`, `exposure`.
- React components: `PascalCase`. Files match component name.
- Python modules and functions: `snake_case`.

### Code style

- Backend: `ruff` + `ruff format`. Type hints required on public functions.
- Frontend: ESLint + Prettier. Strict TypeScript. No `any` without a comment
  explaining why.
- No comments unless a reviewer would otherwise misread the code. Self-naming
  preferred.

### Secrets

- All API keys via environment variables, loaded by the backend.
- `.env.example` is committed; `.env` is **gitignored**.
- Expected keys (final names confirmed by backend owner): `MML_API_KEY`,
  `FMI_API_KEY` (optional but recommended), `OPENCELLID_API_KEY`,
  `N2YO_API_KEY`.
- Frontend never sees keys. All third-party calls go through the backend.

---

## 6. Data sources — integration cheat sheet

| ID | Provider | Protocol | Auth | Native CRS | Notes |
|---|---|---|---|---|---|
| `mml` | National Land Survey | WMTS (tiles) + WFS (vectors) + GeoTIFF (DEM) | API key | EPSG:3067 | Topographic basemap, buildings, contours, 2 m elevation |
| `fmi` | Finnish Meteorological Institute | WFS (XML) via `fmiopendata` | API key (optional) | EPSG:4326 | Observations, HARMONIE forecast, radar, lightning |
| `statfin` | Statistics Finland | PxWeb REST (JSON-stat) + Paavo WFS | none | EPSG:3067 (Paavo) | Demographics by municipality / postal code |
| `digiroad` | Väylä | GeoPackage download + WFS | none | EPSG:3067 | Roads, bridges with load capacity, ferries |
| `opencellid` | OpenCelliD | CSV dump or REST | API key | EPSG:4326 | Prefer CSV dump (no rate limit) |
| `n2yo` | N2YO | REST (JSON) | API key | n/a | Satellite overpasses for given lat/lon |
| `osm` | OpenStreetMap | Overpass API | none | EPSG:4326 | Hospitals, fuel, power lines, ports — for global generalisability |

The MML WMTS basemap is **fetched directly by the frontend** (it's just tile
URLs with the API key in a query string — proxy through backend if we want
to hide the key, otherwise inline). Everything else goes through the backend.

---

## 7. Hackathon priority order

Build vertically. Each step must produce something demoable end-to-end.

1. **Skeleton**: empty Leaflet map with OSM basemap + FastAPI hello-world +
   bbox query plumbing.
2. **MML WMTS basemap** as a switchable base layer.
3. **Drawing tools** (geoman) with route + danger zone + marker.
4. **Digiroad roads & bridges** layer from a local GeoPackage, filtered by
   bbox.
5. **FMI weather** widget in the dashboard (current + 24 h forecast for AOI
   centroid).
6. **Statistics Finland Paavo** population choropleth.
7. **OpenCelliD** clustered points + simple coverage buffer rings.
8. **OSM Overpass** layer for hospitals / fuel / power (the
   generalisability story).
9. **N2YO** satellite overpass schedule in the dashboard.
10. **Source-status panel** showing which providers responded for the
    current AOI (judging criterion).

Anything beyond 10 is bonus: line-of-sight from MML DEM, cross-layer
analysis ("which roads cross the danger zone the user just drew?"),
LLM-generated AOI summary, etc.

---

## 8. Running the project

> Both apps run independently. The frontend's Vite dev server proxies `/api`
> to the backend on `localhost:8000`.

### Backend

See `backend/README.md` once the backend owner has scaffolded the service.
Whatever the stack, it must listen on `http://localhost:8000` and expose
the endpoints in §6 so the frontend dev proxy works unchanged.

### Frontend

```bash
cd frontend
npm install
npm run dev                            # http://localhost:5173
```

---

## 9. Rules for AI agents working on this repo

- **Stay in your zone.** See §0 for the exact file boundaries.
  Frontend agents do not edit `backend/`, and vice versa, unless the
  user explicitly says so.
- **Honour the GeoJSON-EPSG:4326 contract.** Do not invent new response
  shapes. If a new endpoint is needed, document it in §6 of this file in the
  same change.
- **No silent failures.** If an upstream source is down, return a structured
  empty result with `meta.status` set; do not throw 500s, do not return
  fake data.
- **Minimal dependencies.** Before adding a library, check if Leaflet /
  GeoPandas / FastAPI already do it. Justify additions in the PR / commit
  message.
- **No hard-coded secrets.** Ever. Use env vars.
- **No commits of files in `data/`.** It is gitignored for a reason.
- **Update this file** when architecture, source list, endpoint shape, or
  folder layout changes. Out-of-date instructions are worse than none.
- **Preserve `challenge.md`** verbatim — it's the original brief.

---

## 10. Glossary

- **IPB** — Intelligence Preparation of the Battlespace. The process this
  tool automates. See MCRP 2-10B.1.
- **AOI** — Area of Interest. The bbox/polygon the user is analysing.
- **WFS / WMTS / WMS** — OGC web services for vector features and raster
  tiles respectively.
- **EPSG:3067** — ETRS-TM35FIN, the projected CRS used by most Finnish
  authorities.
- **EPSG:4326** — WGS84 geographic CRS (lon/lat). Our wire format.
- **GeoJSON** — JSON encoding for geographic features. Our wire format.
