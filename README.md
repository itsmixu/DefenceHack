# L1NX — Junction × Aalto Defence Hackathon

## **61N Challenge**: automate intelligence preparation of the battlespace (IPB) using open-source data.

**L1NX** turns any area of interest into a full operational picture — in seconds. Drop a location, get live terrain analysis, weather intelligence, infrastructure mapping, satellite windows, population data, and automated threat indexing, all fused onto a single interactive map. Built for speed, designed for the field.

🟢 **Live at [l1nx.mikohur.me](https://l1nx.mikohur.me)** — fully wired-up backend, no setup required.

<img width="1000" alt="L1NX screenshot" src="https://github.com/user-attachments/assets/e4359f46-1e82-43e0-809e-190acf8967cb" />

## Local development

Two terminals from the repo root:

```bash
# terminal 1 — backend (FastAPI on :8000)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # fill in API keys
uvicorn app.main:app --reload --port 8000
```

```bash
# terminal 2 — frontend (Vite on :5173, proxies /api → :8000)
cd frontend
npm install
npm run dev
```

See [`RUNNING.md`](./RUNNING.md) for the API-key list and common issues.

## Deployment

Hosted on [Fly.io](https://fly.io) at [l1nx.mikohur.me](https://l1nx.mikohur.me).
The FastAPI backend serves the built SPA on the same origin, with a
persistent volume for the layer cache and saved plans.

## Data sources

National Land Survey of Finland (MML), Finnish Meteorological Institute
(FMI), Statistics Finland, Digiroad / Väylä, OpenCelliD, N2YO, and
OpenStreetMap. Full integration details in `AGENTS.md` §6.

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
| Hosting | Fly.io (single VM, ARN region) + persistent volume for cache & plans |
