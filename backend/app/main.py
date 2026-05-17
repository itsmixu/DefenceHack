"""FastAPI entrypoint. Run with: uvicorn app.main:app --reload --port 8000"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .http_client import close_client
from .routers import analyze, collab, filesystem, layers, operations, sources, tiles, timeline

load_dotenv()


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        yield
    finally:
        await close_client()


app = FastAPI(
    title="DefenceHack IPB Backend",
    description="Open-source data layers for Intelligence Preparation of the Battlespace.",
    version="0.1.0",
    lifespan=lifespan,
)

_default_origins = "http://localhost:5173,http://127.0.0.1:5173"
_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", _default_origins).split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["*"],
)

app.include_router(sources.router)
app.include_router(layers.router)
app.include_router(operations.router)
app.include_router(analyze.router)
app.include_router(tiles.router)
app.include_router(timeline.router)
app.include_router(filesystem.router)

if os.getenv("ENABLE_COLLAB", "true").lower() == "true":
    app.include_router(collab.router)


@app.get("/api/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}


_dist = Path(__file__).resolve().parents[1] / "frontend_dist"
if _dist.is_dir():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="spa")
