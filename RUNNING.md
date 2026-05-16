# Running the project

Two services. Run each in its own terminal from the repo root.

## Prerequisites

- **Python 3.11+** (for the backend)
- **Node.js 18+ and npm** (for the frontend)
- A working C toolchain (GeoPandas / Shapely pull native wheels — usually
  fine on Linux/macOS; on Windows use WSL if pip complains)

## 1. Backend — FastAPI on `:8000`

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                # fill in API keys (see below)
uvicorn app.main:app --reload --port 8000
```

Smoke test in a third terminal:

```bash
curl http://localhost:8000/api/health
curl http://localhost:8000/api/sources
```

### API keys

Edit `backend/.env`. All keys are optional — providers without a key
report `status: "unavailable"` and the UI shows them as unavailable
rather than crashing.

| Variable             | Provider          | Where to get it |
|----------------------|-------------------|-----------------|
| `MML_API_KEY`        | National Land Survey of Finland | https://www.maanmittauslaitos.fi/en/maps-and-spatial-data/datasets-and-interfaces |
| `FMI_API_KEY`        | Finnish Meteorological Institute (optional) | https://en.ilmatieteenlaitos.fi/open-data-manual |
| `OPENCELLID_API_KEY` | OpenCelliD        | https://opencellid.org/register.php |
| `N2YO_API_KEY`       | N2YO satellites   | https://www.n2yo.com/api/ |

## 2. Frontend — Vite on `:5173`

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api` to
`http://localhost:8000`, so the backend must be running for layers to
load.

## Common issues

- **Frontend loads but every layer says "unavailable":** the backend
  isn't running, or its port isn't 8000. Check `curl http://localhost:8000/api/health`.
- **`pip install` fails on `geopandas` / `shapely`:** upgrade pip
  (`pip install --upgrade pip`), or use a Python 3.11 from python.org
  rather than the system one.
- **Map tiles missing:** `MML_API_KEY` not set — the OSM basemap still
  works; switch basemap in the map's basemap panel.
- **Port already in use:** another service is on `:8000` or `:5173`.
  Kill it, or change ports (`uvicorn … --port 8001`; update
  `frontend/vite.config.ts` proxy target accordingly).

## Production build (optional)

```bash
cd frontend && npm run build       # outputs frontend/dist/
```

The backend can be served by `uvicorn` directly; for a real deployment
put it behind nginx and serve the built frontend as static files.
