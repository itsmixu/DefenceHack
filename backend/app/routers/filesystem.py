"""File system API — project files and folders.

WHY THIS EXISTS:
Provides a VS Code-style file-tree where each saved file is a complete
recording of the IPB tool state at save time.

The critical difference from the old /api/plans system:
  OLD: saved metadata (which layers were on, drawn shapes, notes).
       Opening restores toggles, then re-fetches live data.
  NEW: saves everything — including the actual GeoJSON feature data
       from every active layer (layer_snapshots). Opening a file injects
       those snapshots directly into the frontend cache so the map shows
       exactly what was on screen when the file was saved, down to the
       correct timeline position.

ENDPOINT OVERVIEW:
  GET  /api/fs/tree                  — full sidebar tree (no layer data)
  GET  /api/fs/recent                — recently updated files
  GET  /api/fs/search?q=             — name / notes search

  POST /api/fs/folders               — create folder
  PATCH /api/fs/folders/{id}         — rename / move folder
  DELETE /api/fs/folders/{id}        — delete folder (?recursive=true)

  POST  /api/fs/files                — save (create or overwrite) a file
  GET   /api/fs/files/{id}           — open file (full content + snapshots)
  PATCH /api/fs/files/{id}           — rename / move without replacing content
  POST  /api/fs/files/{id}/duplicate — copy a file
  DELETE /api/fs/files/{id}          — delete file
  GET  /api/fs/folders/{id}/contents — direct children of a folder
"""
from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from .. import fs_store

router = APIRouter(prefix="/api/fs", tags=["filesystem"])


# ── Tree / discovery ──────────────────────────────────────────────────────────

@router.get("/tree")
def get_tree() -> dict[str, Any]:
    """Full sidebar tree: all folders + all file metadata.

    Does NOT include layer_snapshots — this response is always fast.
    Use GET /api/fs/files/{id} to load a file's full content.
    """
    return fs_store.list_tree()


@router.get("/recent")
def get_recent(limit: int = Query(10, ge=1, le=50)) -> list[dict[str, Any]]:
    """N most recently saved files (metadata only, newest first)."""
    return fs_store.list_recent(limit)


@router.get("/search")
def search(q: str = Query(..., min_length=1)) -> list[dict[str, Any]]:
    """Search file names, notes preview, and unit name (case-insensitive)."""
    return fs_store.search_files(q)


# ── Folders ───────────────────────────────────────────────────────────────────

@router.get("/folders/{folder_id}/contents")
def folder_contents(folder_id: str) -> dict[str, Any]:
    """Direct children of a specific folder (folders + files)."""
    if fs_store.get_folder(folder_id) is None:
        raise HTTPException(404, f"folder '{folder_id}' not found")
    return fs_store.get_folder_contents(folder_id)


@router.get("/root")
def root_contents() -> dict[str, Any]:
    """Direct children of the root (folder_id = None)."""
    return fs_store.get_folder_contents(None)


@router.post("/folders", status_code=201)
def create_folder(body: dict[str, Any]) -> dict[str, Any]:
    """Create a new folder.

    Body: { name: str, parent_id?: str | null }
    """
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    # Validate parent exists if provided
    parent_id = body.get("parent_id")
    if parent_id and fs_store.get_folder(parent_id) is None:
        raise HTTPException(404, f"parent folder '{parent_id}' not found")
    return fs_store.create_folder(name, parent_id=parent_id)


@router.patch("/folders/{folder_id}")
def update_folder(folder_id: str, body: dict[str, Any]) -> dict[str, Any]:
    """Rename and/or move a folder.

    Body: { name?: str, parent_id?: str | null }
    """
    if fs_store.get_folder(folder_id) is None:
        raise HTTPException(404, f"folder '{folder_id}' not found")

    folder: dict[str, Any] | None = None

    if "name" in body:
        name = (body["name"] or "").strip()
        if not name:
            raise HTTPException(400, "name cannot be empty")
        folder = fs_store.rename_folder(folder_id, name)

    if "parent_id" in body:
        new_parent = body.get("parent_id")
        # Guard against moving a folder into itself or a descendant
        if new_parent == folder_id:
            raise HTTPException(400, "a folder cannot be its own parent")
        folder = fs_store.move_folder(folder_id, new_parent)

    return folder or fs_store.get_folder(folder_id) or {}  # type: ignore[return-value]


@router.delete("/folders/{folder_id}", status_code=204)
def delete_folder(
    folder_id: str,
    recursive: bool = Query(
        False,
        description="Set true to delete all contents. Without this the folder must be empty.",
    ),
) -> None:
    ok, reason = fs_store.delete_folder(folder_id, recursive=recursive)
    if not ok:
        status = 404 if reason == "not found" else 409
        raise HTTPException(status, reason)


# ── Files ─────────────────────────────────────────────────────────────────────

@router.post("/files", status_code=201)
def save_file(body: dict[str, Any]) -> dict[str, Any]:
    """Create or overwrite a project file.

    Pass body.id to update an existing file; omit it to create a new one.
    Returns the file metadata (no layer_snapshots) — use GET /files/{id}
    to reload the full content.

    Body fields (* = stored in both metadata index and full content):
      id*                 (str?)   omit to create; provide to overwrite
      name*               (str)    display name — shown in sidebar
      folder_id*          (str?)   parent folder; null = root
      bbox*               (list?)  [west, south, east, north]
      center              (list?)  [lat, lon] map centre
      zoom                (float?) leaflet zoom level
      timeline_selected_ms* (int?) ms-since-epoch of the timeline scrubber
      active_layers*      (list)   layer IDs that were toggled on
      drawn_features      (obj)    GeoJSON FeatureCollection of user shapes
      phases              (list)   phase objects (up to 5)
      current_phase       (int)    active phase index
      layer_snapshots     (obj)    {layer_id: GeoJSON FeatureCollection}
                                   THE RECORDING: actual fetched features
                                   for every active layer at save time
      conditions          (obj)    {fmi: {...}, astronomy: {...}}
      notes               (str)    free-text planning notes
      unit*               (str)    unit name (for command hierarchy)
      commander_name      (str)    person who saved this file
      parent_file_id*     (str?)   links to parent commander's file
    """
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")

    # Validate folder_id if provided
    folder_id = body.get("folder_id")
    if folder_id and fs_store.get_folder(folder_id) is None:
        raise HTTPException(404, f"folder '{folder_id}' not found")

    try:
        return fs_store.save_file(body)
    except fs_store.HierarchyError as exc:
        raise HTTPException(400, str(exc))


@router.get("/files/{file_id}")
def open_file(file_id: str) -> dict[str, Any]:
    """Open a project file — returns full content including layer_snapshots.

    The frontend should:
      1. Set timeline_selected_ms in useTimelineStore.
      2. Inject layer_snapshots into useFeatureCacheStore (bypassing network).
      3. Restore drawn_features, phases, active_layers.
      4. FlyTo bbox / center+zoom.
      5. Display conditions card if conditions is non-empty.
    """
    content = fs_store.get_file_content(file_id)
    if content is None:
        raise HTTPException(404, f"file '{file_id}' not found")
    return content


@router.patch("/files/{file_id}")
def update_file_meta(file_id: str, body: dict[str, Any]) -> dict[str, Any]:
    """Rename, move, or update command-hierarchy fields on a file.

    Body fields (all optional, any subset can be provided):
      name              str
      folder_id         str | null
      rank              int  (1..7, clamped)
      unit              str
      commander_name    str
      parent_file_id    str | null   (validated: must outrank child, no cycle)
    """
    if fs_store.get_file_meta(file_id) is None:
        raise HTTPException(404, f"file '{file_id}' not found")

    meta: dict[str, Any] | None = None

    if "name" in body:
        name = (body["name"] or "").strip()
        if not name:
            raise HTTPException(400, "name cannot be empty")
        meta = fs_store.rename_file(file_id, name)

    if "folder_id" in body:
        folder_id = body.get("folder_id")
        if folder_id and fs_store.get_folder(folder_id) is None:
            raise HTTPException(404, f"folder '{folder_id}' not found")
        meta = fs_store.move_file(file_id, folder_id)

    hierarchy_keys = {"rank", "unit", "commander_name", "parent_file_id"}
    if hierarchy_keys & body.keys():
        try:
            meta = fs_store.update_file_metadata(
                file_id, {k: body[k] for k in hierarchy_keys if k in body},
            )
        except fs_store.HierarchyError as exc:
            raise HTTPException(400, str(exc))

    return meta or fs_store.get_file_meta(file_id) or {}  # type: ignore[return-value]


# ── Command hierarchy ─────────────────────────────────────────────────────────

@router.get("/files/{file_id}/hierarchy")
def file_hierarchy(file_id: str) -> dict[str, Any]:
    """Return the full command picture for a file.

    Response:
      {
        self:        FsFileMeta,
        ancestors:   FsFileMeta[]   immediate parent → root commander
        descendants: FsFileMeta[]   all subordinates (BFS order)
        siblings:    FsFileMeta[]   peers sharing the same parent
      }
    """
    result = fs_store.get_hierarchy(file_id)
    if result is None:
        raise HTTPException(404, f"file '{file_id}' not found")
    return result


@router.get("/files/{file_id}/ancestors")
def file_ancestors(file_id: str) -> list[dict[str, Any]]:
    """Walk parent_file_id from this file up to the root commander."""
    if fs_store.get_file_meta(file_id) is None:
        raise HTTPException(404, f"file '{file_id}' not found")
    return fs_store.list_ancestors(file_id)


@router.get("/files/{file_id}/descendants")
def file_descendants(
    file_id: str,
    recursive: bool = Query(True, description="Walk the full subtree (default) or only immediate children."),
) -> list[dict[str, Any]]:
    """All subordinate files (recursive by default)."""
    if fs_store.get_file_meta(file_id) is None:
        raise HTTPException(404, f"file '{file_id}' not found")
    return fs_store.list_descendants(file_id, recursive=recursive)


@router.get("/ranks")
def list_ranks() -> dict[str, Any]:
    """Echelon table: numeric rank → display name. Used by the rank picker UI."""
    return {
        "default": fs_store.RANK_DEFAULT,
        "min":     fs_store.RANK_MIN,
        "max":     fs_store.RANK_MAX,
        "levels":  [
            {"rank": r, "name": fs_store.RANK_NAMES[r]}
            for r in range(fs_store.RANK_MIN, fs_store.RANK_MAX + 1)
        ],
    }


@router.post("/files/{file_id}/duplicate", status_code=201)
def duplicate_file(file_id: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    """Create a copy of a file in the same folder.

    Optional body: { name?: str }
    """
    new_name = ((body or {}).get("name") or "").strip() or None
    result = fs_store.duplicate_file(file_id, new_name)
    if result is None:
        raise HTTPException(404, f"file '{file_id}' not found")
    return result


@router.delete("/files/{file_id}", status_code=204)
def delete_file(file_id: str) -> None:
    if not fs_store.delete_file(file_id):
        raise HTTPException(404, f"file '{file_id}' not found")


# ── Export / Import ────────────────────────────────────────────────────────────

@router.get("/files/{file_id}/export")
def export_file(file_id: str) -> JSONResponse:
    """Export a file as a self-contained .ipb.json (v2 format).

    Sets Content-Disposition so browsers prompt a download.
    """
    result = fs_store.export_file_v2(file_id)
    if result is None:
        raise HTTPException(404, f"file '{file_id}' not found")
    raw_name = result.get("file", {}).get("name", "operation")
    safe_name = re.sub(r"[^\w\s\-.]", "_", raw_name).strip() or "operation"
    return JSONResponse(
        content=result,
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.ipb.json"'},
    )


@router.post("/import", status_code=201)
def import_file(
    body: dict[str, Any],
    strategy: str = Query(
        "fresh",
        description="'fresh' mints a new local ID (safe default). 'merge' keeps the original ID if it doesn't already exist.",
    ),
) -> dict[str, Any]:
    """Import a .ipb.json v2 export. Returns the created file metadata."""
    try:
        return fs_store.import_file_v2(body, strategy=strategy)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
