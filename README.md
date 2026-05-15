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

## Data sources

National Land Survey of Finland (MML), Finnish Meteorological Institute
(FMI), Statistics Finland, Digiroad / Väylä, OpenCelliD, N2YO, and
OpenStreetMap. Full integration details in `AGENTS.md` §6.

## Team

- Backend (Python, data fetching) — Artem.
- Frontend (map, drawing, dashboard) — Miko.

Joined only by the GeoJSON-over-HTTP contract documented in `AGENTS.md`.
