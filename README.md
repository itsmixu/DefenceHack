# DefenceHack — 61N IPB Tool

Web tool for the **Junction Defence Hackathon — 61N Challenge**: automate
intelligence preparation of the battlespace (IPB) using open-source data.

Given an Area of Interest and a timeframe, the tool retrieves, processes,
and visualises operationally relevant open-source data (terrain, weather,
infrastructure, demographics, satellite overpasses, etc.) on an interactive
2D map with drawing tools and a dashboard.

## Repo layout

- `challenge.md` — the original 61N challenge brief.
- **`AGENTS.md` — single source of truth for architecture, conventions, API
  contract, and data-source integration. Read this before doing anything.**
- `backend/` — Python service that exposes GeoJSON over HTTP (scaffolded by the backend owner; framework TBD).
- `frontend/` — Vite + React + Leaflet map app.
- `data/` — gitignored local cache and raw downloads.

## Quick start

In two terminals:

```bash
# terminal 1 — backend
# (Python service, scaffolded by the backend owner — see backend/README.md.
#  Must listen on http://localhost:8000.)
```

```bash
# terminal 2 — frontend
cd frontend
npm install
npm run dev                  # http://localhost:5173
```

## Demo mode (no backend)

The frontend ships with a preloaded snapshot of central Joensuu so the
whole tool can run as a static SPA — useful for hackathon judges, video
demos, or anyone without the backend running.

- **Use it:** open any deploy of `npm run build` (or `npm run dev`) with
  the query flag `?demo=1` — e.g. `https://your-site.example/?demo=1`.
  An amber `DEMO · Joensuu` pill appears at the bottom of the screen.
- **Refresh the snapshot:** with the backend running locally, run
  `./scripts/capture-demo-snapshot.sh`. This re-captures all 13 layers
  and the briefing analyses into `frontend/public/demo/`.
- **What's stubbed:** collab is disabled, file save/rename/delete are
  no-ops, and the map is clamped to the captured AO so the user can't
  pan into empty bbox cells. Everything else (drawing, symbols, ruler,
  briefing cards, popups) works as in the live app.

## Data sources

National Land Survey of Finland (MML), Finnish Meteorological Institute
(FMI), Statistics Finland, Digiroad / Väylä, OpenCelliD, N2YO, and
OpenStreetMap. Full integration details in `AGENTS.md` §6.

## Team

- Backend (Python, data fetching) — Artem.
- Frontend (map, drawing, dashboard) — Miko.

Joined only by the GeoJSON-over-HTTP contract documented in `AGENTS.md`.

---

## Hackathon submission — L1NX

### The problem

Military planning is slow by design — analysts currently spend two to four weeks manually cross-referencing maps, weather services, road databases, and demographic sources before a plan is ready. On a modern battlefield that moves in minutes, that lag is operationally fatal. A 150-soldier force inserted near Joensuu can march, demolish bridges, and occupy key terrain before a traditionally-produced IPB product is even finished.

### What we built

**L1NX** is a real-time, browser-based operations planning platform that collapses the IPB timeline from weeks to seconds. It fuses all operationally relevant open-source data into a single interactive map and adds collaborative editing so commanders and team leaders can work on the same picture simultaneously.

**Data layers — live on the map:**
- Critical infrastructure (hospitals, fuel, fire stations) via OpenStreetMap
- Roads, bridges & load limits via Digiroad / Väylä
- Terrain types, elevation contours & flood-risk zones via MML & SYKE
- Population density & demographics via Statistics Finland (Paavo)
- Live weather observations and 48-hour forecasts via FMI HARMONIE NWP
- Cell tower coverage & signal corridors via OpenCelliD
- Live satellite positions & overpass windows via N2YO / Celestrak

**Automated analysis — computed server-side:**
- **Danger zone index** — automated exposure scoring (L1 hard cover → L5 fully exposed) fused from terrain and land-use
- **Vehicle Mobility (MCOO)** — per-polygon GO / SLOW-GO / NO-GO rating for wheeled and tracked vehicles
- **Drone flight windows** — real-time wind, ceiling, visibility and temperature fused into a per-hour go / marginal / no-go forecast strip
- **Night operations window** — moon phase, illumination and civil twilight calculated for any date in the AO

**Planning tools:**
- NATO APP-6 military symbol library — click to place, drag to reposition
- Tactical drawing palette (AOI, NAI, TAI, phase lines, routes, objectives)
- Arrow and ruler tools with real-world distance readout
- File manager — save, version and reload complete map snapshots including all layer data and drawn features

**Collaboration:**
- Real-time leader / follower sessions over SSE — first browser to open becomes Alpha (leader), subsequent browsers join as Bravo, Charlie, etc.
- Leader's drawn features, symbols and arrows sync to all followers within ~300 ms
- Followers can request and receive leadership with a single click

### Tech stack

| Layer | Stack |
|---|---|
| Backend | Python 3.11, FastAPI, httpx, pyproj, GeoPandas |
| Frontend | TypeScript, React 18, Vite, Leaflet / react-leaflet, Zustand, TanStack Query |
| Data | MML WFS, FMI WFS/API, Statistics Finland WFS, Digiroad WFS, OpenCelliD, N2YO, OSM Overpass, Celestrak TLE |
| Collab | Server-Sent Events (SSE) with in-process session registry |
