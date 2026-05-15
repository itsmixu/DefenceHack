# Backend — DefenceHack IPB Tool

Python service that fetches open-source geospatial data and exposes it as
GeoJSON over HTTP for the frontend map.

> **First, read `../AGENTS.md`.** It defines the architecture, the API
> contract, the CRS rules, and the source-by-source integration cheat sheet.
> Anything in this README is a refinement of that document, not a
> replacement.

## Stack

- Python 3.11+
- FastAPI + Uvicorn
- GeoPandas, Shapely, pyproj
- httpx (async), `fmiopendata`
- Pydantic v2
- ruff (lint + format)

## Layout

```
backend/
├── app/
│   ├── main.py            # FastAPI app, CORS, route registration
│   ├── config.py          # env var loading (API keys)
│   ├── models.py          # Pydantic response schemas
│   ├── geo.py             # CRS reprojection, bbox helpers
│   ├── cache.py           # on-disk cache in ../data/cache
│   └── sources/           # one module per provider
│       ├── mml.py
│       ├── fmi.py
│       ├── statfin.py
│       ├── digiroad.py
│       ├── opencellid.py
│       ├── n2yo.py
│       └── osm.py
└── tests/
```

## API contract (summary — full spec in `../AGENTS.md` §6)

- `GET /api/sources` → list of `{ id, label, status, last_checked, reason? }`.
- `GET /api/layers/<source>?bbox=<minLon,minLat,maxLon,maxLat>&t=<ISO8601>`
  → GeoJSON `FeatureCollection` in **EPSG:4326**.
- On upstream failure: HTTP 200 with empty `FeatureCollection` and
  `meta.status = "unavailable"`. Never silently fake data.

## Run

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # fill in API keys
uvicorn app.main:app --reload --port 8000
```

Docs: <http://localhost:8000/docs>.

## Rules

- All responses in **EPSG:4326**. Reproject from EPSG:3067 (Finnish authority
  data) inside the source modules — never push that to the frontend.
- All API keys via env vars. `.env` is gitignored.
- Cache aggressively in `../data/cache/`. Hackathon demo must not depend on
  upstream APIs being live.
