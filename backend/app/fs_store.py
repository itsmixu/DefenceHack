"""File-system persistence for IPB project files.

WHY THIS EXISTS:
The old plans system saved only metadata (layer toggles, drawn shapes).
This module replaces it with a full project snapshot system: each saved
file captures EVERYTHING at save time, including the actual GeoJSON
feature data returned by every active layer. When a file is opened,
the user sees the map exactly as it looked when it was saved — the
timeline position, the live data, the drawn shapes, all of it.

This is the difference between a "bookmark" (old system) and a
"recording" (this system).

STORAGE LAYOUT:
  data/filesystem/
    index.json            — metadata index: folders + file summaries
                            (no layer data — fast to load for tree view)
    content/
      <file_id>.json      — full project file including layer_snapshots

INDEX vs CONTENT split:
  The sidebar tree only needs names, dates, and folder structure.
  Layer snapshot data can be hundreds of KB per file. Keeping them
  separate means the tree loads instantly even with 100+ saved files.

FILE SCHEMA (content/<id>.json):
  id, name, folder_id, created_at, updated_at     — housekeeping
  bbox, center, zoom                               — viewport
  timeline_selected_ms                             — timeline position (ms epoch)
  active_layers                                    — which layer toggles were on
  drawn_features                                   — GeoJSON FeatureCollection of shapes
  phases                                           — up to 5 phase objects
  current_phase                                    — active phase index
  layer_snapshots                                  — {layer_id: GeoJSON FC}
                                                     KEY FIELD: actual fetched data
  conditions                                       — {fmi: {...}, astronomy: {...}}
  notes                                            — free-text
  unit, commander_name, parent_file_id             — command hierarchy

FOLDER SCHEMA (stored inline in index.json):
  id, name, parent_id, created_at, updated_at
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATA_ROOT   = Path(__file__).resolve().parents[2] / "data"
FS_ROOT     = DATA_ROOT / "filesystem"
CONTENT_DIR = FS_ROOT / "content"
INDEX_FILE  = FS_ROOT / "index.json"

for _d in (FS_ROOT, CONTENT_DIR):
    _d.mkdir(parents=True, exist_ok=True)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


def _load_index() -> dict[str, Any]:
    """Load the metadata index. Returns {folders: {}, files: {}} on any error."""
    if INDEX_FILE.exists():
        try:
            return json.loads(INDEX_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {"folders": {}, "files": {}}


def _save_index(index: dict[str, Any]) -> None:
    INDEX_FILE.write_text(json.dumps(index, indent=2))


# ── Folders ───────────────────────────────────────────────────────────────────

def create_folder(name: str, parent_id: str | None = None) -> dict[str, Any]:
    index = _load_index()
    folder_id = _new_id()
    now = _now()
    folder: dict[str, Any] = {
        "id": folder_id,
        "type": "folder",
        "name": name,
        "parent_id": parent_id,
        "created_at": now,
        "updated_at": now,
    }
    index["folders"][folder_id] = folder
    _save_index(index)
    return folder


def get_folder(folder_id: str) -> dict[str, Any] | None:
    return _load_index()["folders"].get(folder_id)


def rename_folder(folder_id: str, name: str) -> dict[str, Any] | None:
    index = _load_index()
    folder = index["folders"].get(folder_id)
    if folder is None:
        return None
    folder["name"] = name.strip()
    folder["updated_at"] = _now()
    _save_index(index)
    return folder


def move_folder(folder_id: str, new_parent_id: str | None) -> dict[str, Any] | None:
    """Reparent a folder. Cycles are not checked — caller must verify."""
    index = _load_index()
    folder = index["folders"].get(folder_id)
    if folder is None:
        return None
    folder["parent_id"] = new_parent_id
    folder["updated_at"] = _now()
    _save_index(index)
    return folder


def _descendant_folder_ids(index: dict[str, Any], root_id: str) -> list[str]:
    """BFS over folders to collect all descendant IDs (including root_id)."""
    result: list[str] = []
    queue = [root_id]
    while queue:
        fid = queue.pop()
        result.append(fid)
        queue.extend(
            f["id"] for f in index["folders"].values()
            if f.get("parent_id") == fid
        )
    return result


def delete_folder(folder_id: str, recursive: bool = False) -> tuple[bool, str]:
    """Delete a folder.

    Returns (True, "") on success.
    Returns (False, reason) if the folder is not found or not empty when
    recursive=False.
    """
    index = _load_index()
    if folder_id not in index["folders"]:
        return False, "not found"

    descendants = _descendant_folder_ids(index, folder_id)
    all_file_ids_in_scope = [
        fid for fid, fm in index["files"].items()
        if fm.get("folder_id") in descendants
    ]

    if not recursive and (len(descendants) > 1 or all_file_ids_in_scope):
        return False, "folder is not empty"

    # Remove content files
    for fid in all_file_ids_in_scope:
        index["files"].pop(fid, None)
        p = CONTENT_DIR / f"{fid}.json"
        if p.exists():
            p.unlink()

    # Remove folder entries
    for fid in descendants:
        index["folders"].pop(fid, None)

    _save_index(index)
    return True, ""


# ── Files ─────────────────────────────────────────────────────────────────────

def save_file(data: dict[str, Any]) -> dict[str, Any]:
    """Create or overwrite a project file.

    Pass data["id"] to update an existing file; omit it to create a new one.
    Returns the file metadata (no layer data) as stored in the index.
    """
    index = _load_index()
    file_id: str = data.get("id") or _new_id()
    now = _now()
    existing_meta = index["files"].get(file_id, {})

    # Count features across all layer snapshots (stored in meta for quick display)
    snapshots: dict[str, Any] = data.get("layer_snapshots") or {}
    feature_count = sum(
        len((v or {}).get("features", []))
        for v in snapshots.values()
    )

    meta: dict[str, Any] = {
        "id": file_id,
        "type": "file",
        "name": (data.get("name") or "Untitled").strip(),
        "folder_id": data.get("folder_id"),                    # None = root
        "created_at": existing_meta.get("created_at", now),
        "updated_at": now,
        # Viewport summary — shown in sidebar tooltip / recent list
        "bbox":                  data.get("bbox"),
        "active_layers":         data.get("active_layers", []),
        "timeline_selected_ms":  data.get("timeline_selected_ms"),
        "layer_count":           len(snapshots),
        "feature_count":         feature_count,
        # Command hierarchy
        "unit":                  data.get("unit", ""),
        "commander_name":        data.get("commander_name", ""),
        "parent_file_id":        data.get("parent_file_id"),
        # Notes preview (truncated for index)
        "notes_preview":         (data.get("notes") or "")[:120],
    }

    full_content: dict[str, Any] = {
        **meta,
        # Full notes (not truncated)
        "notes":             data.get("notes", ""),
        # Map state
        "center":            data.get("center"),
        "zoom":              data.get("zoom"),
        # Drawn shapes
        "drawn_features":    data.get(
            "drawn_features",
            {"type": "FeatureCollection", "features": []},
        ),
        # Phase planning
        "phases":            data.get("phases", []),
        "current_phase":     data.get("current_phase", 0),
        # === THE CORE SNAPSHOT ===
        # Actual GeoJSON features returned by every active layer at save time.
        # Opening this file injects these directly into the feature cache so
        # the map shows exactly what was on screen when the file was saved.
        "layer_snapshots":   snapshots,
        # Conditions at save time (FMI weather, astronomy)
        "conditions":        data.get("conditions", {}),
    }

    index["files"][file_id] = meta
    _save_index(index)
    (CONTENT_DIR / f"{file_id}.json").write_text(json.dumps(full_content))
    return meta


def get_file_meta(file_id: str) -> dict[str, Any] | None:
    return _load_index()["files"].get(file_id)


def get_file_content(file_id: str) -> dict[str, Any] | None:
    """Return full file content including layer_snapshots."""
    path = CONTENT_DIR / f"{file_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def rename_file(file_id: str, name: str) -> dict[str, Any] | None:
    index = _load_index()
    meta = index["files"].get(file_id)
    if meta is None:
        return None
    meta["name"] = name.strip()
    meta["updated_at"] = _now()
    _save_index(index)
    # Mirror to content file
    path = CONTENT_DIR / f"{file_id}.json"
    if path.exists():
        try:
            content = json.loads(path.read_text())
            content["name"]       = meta["name"]
            content["updated_at"] = meta["updated_at"]
            path.write_text(json.dumps(content))
        except (json.JSONDecodeError, OSError):
            pass
    return meta


def move_file(file_id: str, folder_id: str | None) -> dict[str, Any] | None:
    """Move a file to a different folder (or to root with folder_id=None)."""
    index = _load_index()
    meta = index["files"].get(file_id)
    if meta is None:
        return None
    meta["folder_id"] = folder_id
    meta["updated_at"] = _now()
    _save_index(index)
    # Mirror to content file
    path = CONTENT_DIR / f"{file_id}.json"
    if path.exists():
        try:
            content = json.loads(path.read_text())
            content["folder_id"]  = folder_id
            content["updated_at"] = meta["updated_at"]
            path.write_text(json.dumps(content))
        except (json.JSONDecodeError, OSError):
            pass
    return meta


def duplicate_file(file_id: str, new_name: str | None = None) -> dict[str, Any] | None:
    """Create a copy of a file with a new ID (in the same folder)."""
    content = get_file_content(file_id)
    if content is None:
        return None
    content.pop("id", None)
    content["name"] = new_name or f"{content.get('name', 'Copy')} (copy)"
    return save_file(content)


def delete_file(file_id: str) -> bool:
    index = _load_index()
    if file_id not in index["files"]:
        return False
    index["files"].pop(file_id)
    _save_index(index)
    path = CONTENT_DIR / f"{file_id}.json"
    if path.exists():
        path.unlink()
    return True


# ── Query helpers ─────────────────────────────────────────────────────────────

def list_tree() -> dict[str, Any]:
    """Return the full sidebar tree: all folders + all file metadata.

    No layer_snapshots included — this is the fast path for the sidebar.
    """
    index = _load_index()
    return {
        "folders": list(index["folders"].values()),
        "files":   list(index["files"].values()),
    }


def list_recent(limit: int = 10) -> list[dict[str, Any]]:
    """Return the N most recently saved files (metadata only)."""
    index = _load_index()
    return sorted(
        index["files"].values(),
        key=lambda f: f.get("updated_at", ""),
        reverse=True,
    )[:limit]


def search_files(query: str) -> list[dict[str, Any]]:
    """Case-insensitive search across file names and notes_preview."""
    index = _load_index()
    q = query.lower()
    return [
        f for f in index["files"].values()
        if q in (f.get("name") or "").lower()
        or q in (f.get("notes_preview") or "").lower()
        or q in (f.get("unit") or "").lower()
    ]


def get_folder_contents(folder_id: str | None) -> dict[str, Any]:
    """Return direct children of a folder (or root if folder_id is None)."""
    index = _load_index()
    folders = [f for f in index["folders"].values() if f.get("parent_id") == folder_id]
    files   = [f for f in index["files"].values()   if f.get("folder_id") == folder_id]
    return {"folders": folders, "files": files}
