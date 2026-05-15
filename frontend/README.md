# Frontend — DefenceHack IPB Tool

Interactive 2D map web app for visualising open-source geospatial
intelligence and drawing operational overlays (routes, danger zones,
markers).

> **First, read `../AGENTS.md`.** It defines the architecture, the API
> contract the backend exposes, and the layer/drawing conventions. This
> README is just a refinement.

## Stack

- Vite + React 18 + TypeScript
- **Leaflet** via `react-leaflet`
- `@geoman-io/leaflet-geoman-free` for drawing
- `leaflet.markercluster`, `leaflet.heat` as needed
- Tailwind CSS + shadcn/ui + Lucide icons
- Zustand for shared state (only when needed)
- Native `fetch` for HTTP

## Layout

```
frontend/src/
├── main.tsx
├── App.tsx
├── api/                   # typed clients for backend endpoints
├── map/
│   ├── MapView.tsx        # Leaflet container
│   ├── basemaps.ts        # OSM, MML WMTS configs
│   └── layers/            # one component per data layer
├── drawing/               # geoman setup, drawn-features store
├── dashboard/             # side panel, stats widgets, source-status list
└── lib/                   # bbox, geojson helpers
```

## Run

```bash
npm install
npm run dev                # http://localhost:5173
```

The dev server proxies `/api` to `http://localhost:8000` (the backend).
Configure in `vite.config.ts`.

## Rules

- Render only **EPSG:4326** GeoJSON from the backend. No CRS work in the
  browser.
- Drawn shapes live client-side (Zustand store). Do not POST them to the
  backend in v1.
- Each data layer has a toggle in the layer panel and respects the current
  AOI bbox + timeframe.
- The source-status panel must surface which providers are `unavailable`
  for the current AOI — this is a judging criterion.
- No API keys in frontend code. Anything secret goes through the backend.
