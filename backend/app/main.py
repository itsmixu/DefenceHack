"""FastAPI entrypoint. Run with: uvicorn app.main:app --reload --port 8000"""
from __future__ import annotations

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import analyze, layers, operations, sources, tiles, timeline

load_dotenv()

app = FastAPI(
    title="DefenceHack IPB Backend",
    description="Open-source data layers for Intelligence Preparation of the Battlespace.",
    version="0.1.0",
)

# Frontend dev server runs on :5173 (Vite). Permissive for hackathon; tighten later.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["*"],
)

app.include_router(sources.router)
app.include_router(layers.router)
app.include_router(operations.router)
app.include_router(analyze.router)
app.include_router(tiles.router)
app.include_router(timeline.router)


@app.get("/api/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}
