# Backend — DefenceHack IPB Tool

Python service that fetches open-source geospatial data and exposes it as
GeoJSON over HTTP for the frontend map.

## Stack

- Python 3.11+
- FastAPI + Uvicorn
- Pydantic v2 for response models
- `python-dotenv` for env loading, `httpx` for async upstream calls
- GeoPandas / pyproj added per-provider when reprojection from EPSG:3067 is needed

## Run

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in keys as providers come online
uvicorn app.main:app --reload --port 8000
```

Smoke test:

```bash
curl http://localhost:8000/api/health
curl http://localhost:8000/api/sources
curl "http://localhost:8000/api/layers/osm?bbox=24.5,60.1,25.3,60.4"
```

## Before you start

1. **Read `../AGENTS.md` end to end.** It defines the architecture, the
   shared HTTP/GeoJSON contract, the CRS rules, the secret-handling rules,
   and a per-source integration cheat sheet (\u00a76). Those constraints are
   binding regardless of which Python stack you pick.
2. Once you've decided on the stack (framework, key libraries, run command,
   port), **update \u00a73 "Backend" in `../AGENTS.md`** so the frontend agent
   knows what it's talking to. Also update this README with run
   instructions.

## Hard requirements (from `../AGENTS.md`)

- Listen on `http://localhost:8000` (the frontend Vite dev server proxies
  `/api` here).
- Every layer endpoint returns a GeoJSON `FeatureCollection` in **EPSG:4326**.
  Reproject from EPSG:3067 (Finnish authority data) inside the source
  modules \u2014 never on the wire.
- Expose at minimum:
  - `GET /api/sources` \u2014 list of `{ id, label, status, last_checked,
    reason? }`.
  - `GET /api/layers/<source>?bbox=<minLon,minLat,maxLon,maxLat>&t=<ISO8601>`
    \u2014 GeoJSON FeatureCollection.
- On upstream failure: HTTP 200 with an empty `FeatureCollection` and
  `meta.status = "unavailable"` plus `meta.reason`. Never silently fake data.
- All API keys via env vars. Commit `.env.example`, never `.env`.
- Cache responses under `../data/cache/` so the demo survives flaky
  networks. `../data/` is gitignored.

## Source IDs to implement (priority order in `../AGENTS.md` \u00a77)

`mml`, `digiroad`, `fmi`, `statfin`, `opencellid`, `osm`, `n2yo`.
