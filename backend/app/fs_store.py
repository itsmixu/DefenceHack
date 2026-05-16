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
  layer_snapshots                                  — {layer_id: GeoJSON FC}
                                                     KEY FIELD: actual fetched data
  conditions                                       — {fmi: {...}, astronomy: {...}}
  notes                                            — free-text
  unit, commander_name, parent_file_id             — command hierarchy

The whole map state lives at the top level of the file — there is no
per-phase substructure. The v2 .ipb.json export still emits a single
phase wrapper for backwards compatibility with the on-disk format.

FOLDER SCHEMA (stored inline in index.json):
  id, name, parent_id, created_at, updated_at
"""
from __future__ import annotations

import json
import re
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

# In-memory cache of the index file. Read once, refreshed when mtime changes.
_index_cache: dict[str, Any] | None = None
_index_mtime: float = 0.0


PHASE_COLORS = [
    "#3b82f6",  # blue
    "#22c55e",  # green
    "#ef4444",  # red
    "#f59e0b",  # amber
    "#8b5cf6",  # purple
    "#06b6d4",  # cyan
]

# ── Rank / NATO echelons ──────────────────────────────────────────────────────
#
# Numeric rank determines command hierarchy. A file with HIGHER rank may
# command (parent) files with LOWER rank, but not the other way around.
# Files with the same or higher rank than a candidate parent cannot be made
# its subordinate — this prevents inversion and cycles.
#
#   1 = Team / Crew         (smallest)
#   2 = Squad / Section
#   3 = Platoon             (default for new files)
#   4 = Company / Battery
#   5 = Battalion
#   6 = Brigade / Regiment
#   7 = Division / Corps    (highest)

RANK_DEFAULT = 3
RANK_MIN = 1
RANK_MAX = 7
RANK_NAMES: dict[int, str] = {
    1: "Team",
    2: "Squad",
    3: "Platoon",
    4: "Company",
    5: "Battalion",
    6: "Brigade",
    7: "Division",
}


def _clamp_rank(value: Any) -> int:
    """Coerce any incoming rank value to a valid integer in [RANK_MIN, RANK_MAX]."""
    try:
        n = int(value)
    except (TypeError, ValueError):
        return RANK_DEFAULT
    return max(RANK_MIN, min(RANK_MAX, n))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


def _default_feature_styles() -> dict[str, Any]:
    return {
        "AOI":           {"color": "#ffffff", "fillOpacity": 0.05, "weight": 2, "dashArray": "4,4"},
        "NAI":           {"color": "#3b82f6", "fillOpacity": 0.15, "weight": 2},
        "TAI":           {"color": "#ef4444", "fillOpacity": 0.20, "weight": 2},
        "DP":            {"color": "#f59e0b", "weight": 2},
        "PHASE_LINE":    {"color": "#22c55e", "weight": 3, "dashArray": "8,4"},
        "BOUNDARY":      {"color": "#f59e0b", "weight": 2, "dashArray": "6,3"},
        "ROUTE":         {"color": "#a855f7", "weight": 3},
        "OBJECTIVE":     {"color": "#ef4444", "fillOpacity": 0.25, "weight": 2},
        "UNIT_FRIENDLY": {"color": "#3b82f6", "weight": 2},
        "UNIT_ENEMY":    {"color": "#ef4444", "weight": 2},
        "CHOKE_POINT":   {"color": "#f59e0b", "weight": 2},
        "HIDE_SITE":     {"color": "#22c55e", "fillOpacity": 0.20, "weight": 2, "dashArray": "4,4"},
        "annotation":    {"color": "#9ca3af", "fillOpacity": 0.10, "weight": 1},
    }


def _load_index() -> dict[str, Any]:
    """Load the metadata index. Returns {folders: {}, files: {}} on any error."""
    global _index_cache, _index_mtime
    if not INDEX_FILE.exists():
        if _index_cache is None:
            _index_cache = {"folders": {}, "files": {}}
            _index_mtime = 0.0
        return _index_cache
    try:
        mtime = INDEX_FILE.stat().st_mtime
    except OSError:
        mtime = 0.0
    if _index_cache is not None and mtime == _index_mtime:
        return _index_cache
    try:
        _index_cache = json.loads(INDEX_FILE.read_text())
        _index_mtime = mtime
    except (json.JSONDecodeError, OSError):
        _index_cache = {"folders": {}, "files": {}}
        _index_mtime = 0.0
    return _index_cache


def _save_index(index: dict[str, Any]) -> None:
    global _index_cache, _index_mtime
    INDEX_FILE.write_text(json.dumps(index, indent=2))
    _index_cache = index
    try:
        _index_mtime = INDEX_FILE.stat().st_mtime
    except OSError:
        _index_mtime = 0.0


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

    # Rank validation: clamp to valid range; default to platoon for new files
    rank = _clamp_rank(
        data.get("rank", existing_meta.get("rank", RANK_DEFAULT))
    )

    # Parent-file validation: must reference a file with HIGHER rank, no cycle
    raw_parent_id = data.get("parent_file_id", existing_meta.get("parent_file_id"))
    parent_file_id = _validate_parent_link(
        index, child_id=file_id, child_rank=rank, parent_id=raw_parent_id,
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
        "rank":                  rank,
        "unit":                  data.get("unit", existing_meta.get("unit", "")),
        "commander_name":        data.get("commander_name", existing_meta.get("commander_name", "")),
        "parent_file_id":        parent_file_id,
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
        # === THE CORE SNAPSHOT ===
        # Actual GeoJSON features returned by every active layer at save time.
        # Opening this file injects these directly into the feature cache so
        # the map shows exactly what was on screen when the file was saved.
        "layer_snapshots":   snapshots,
        # Conditions at save time (FMI weather, astronomy)
        "conditions":        data.get("conditions", {}),
        # Phase planning — multi-tab collab feature stores per-phase snapshots.
        # Files saved without phases just persist an empty list / phase 1.
        "phases":            data.get("phases", []),
        "current_phase":     data.get("current_phase", 1),
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


# ── Export / Import (v2 .ipb.json format) ─────────────────────────────────────

def export_file_v2(file_id: str) -> dict[str, Any] | None:
    """Build a self-contained v2 IPB Operation export dict for download."""
    content = get_file_content(file_id)
    if content is None:
        return None

    index = _load_index()

    # Walk folder ancestry → ["Ops", "Spring 2026"]
    folder_path: list[str] = []
    fid = content.get("folder_id")
    while fid:
        folder = index["folders"].get(fid)
        if not folder:
            break
        folder_path.insert(0, folder["name"])
        fid = folder.get("parent_id")

    # One save-file = one complete map state. The v2 export format still
    # carries a phases[] array (for on-disk compatibility), so wrap the
    # file's state as a single phase.
    v2_phases: list[dict[str, Any]] = [{
        "phase_id": 1,
        "name": "Map",
        "color": PHASE_COLORS[0],
        "order": 0,
        "notes": content.get("notes", ""),
        "viewport": {
            "bbox":   content.get("bbox"),
            "center": content.get("center"),
            "zoom":   content.get("zoom"),
        },
        "timeline": {"selected_ms": content.get("timeline_selected_ms")},
        "active_layers": content.get("active_layers", []),
        "drawn_features": content.get(
            "drawn_features", {"type": "FeatureCollection", "features": []}
        ),
        "snapshot": {
            "captured_at":    content.get("updated_at"),
            "conditions":     content.get("conditions", {}),
            "layer_snapshots": content.get("layer_snapshots", {}),
        },
    }]
    current_phase_id = 1

    return {
        "format":         "ipb-operation",
        "format_version": 2,
        "exported_at":    _now(),
        "exported_by": {
            "app":         "DefenceHack IPB Tool",
            "app_version": "0.1.0",
        },
        "file": {
            "original_id":              content.get("id"),
            "name":                     content.get("name"),
            "created_at":               content.get("created_at"),
            "updated_at":               content.get("updated_at"),
            "notes":                    content.get("notes", ""),
            "unit":                     content.get("unit", ""),
            "commander_name":           content.get("commander_name", ""),
            "parent_file_original_id":  content.get("parent_file_id"),
            "folder_path":              folder_path,
        },
        "active_phase_id": current_phase_id,
        "phases":          v2_phases,
        "shared": {
            "drawn_features": {"type": "FeatureCollection", "features": []},
            "feature_styles": _default_feature_styles(),
        },
    }


def import_file_v2(data: dict[str, Any], strategy: str = "fresh") -> dict[str, Any]:
    """Import a v2 .ipb.json dict and persist it. Returns created file metadata."""
    fmt = data.get("format")
    if fmt != "ipb-operation":
        raise ValueError(f"Unsupported format {fmt!r}. Expected 'ipb-operation'.")
    fv = data.get("format_version", 1)
    if fv > 2:
        raise ValueError(f"Format version {fv} is newer than this app supports (max 2).")

    file_info: dict[str, Any] = data.get("file", {})
    phases_v2: list[dict[str, Any]] = data.get("phases", [])
    active_phase_id: int = data.get("active_phase_id", 1)

    # Pick the active phase (or the first one) — its state becomes the
    # entire file. Other phases in a legacy multi-phase export are dropped.
    active_ph = next((p for p in phases_v2 if p.get("phase_id") == active_phase_id), None)
    if not active_ph and phases_v2:
        active_ph = phases_v2[0]

    save_body: dict[str, Any] = {
        "name":            file_info.get("name", "Imported Operation"),
        "notes":           file_info.get("notes", ""),
        "unit":            file_info.get("unit", ""),
        "commander_name":  file_info.get("commander_name", ""),
    }

    if active_ph:
        vp = active_ph.get("viewport", {})
        tl = active_ph.get("timeline", {})
        ss = active_ph.get("snapshot", {})
        save_body.update({
            "bbox":                 vp.get("bbox"),
            "center":               vp.get("center"),
            "zoom":                 vp.get("zoom"),
            "timeline_selected_ms": tl.get("selected_ms"),
            "active_layers":        active_ph.get("active_layers", []),
            "drawn_features":       active_ph.get("drawn_features", {"type": "FeatureCollection", "features": []}),
            "layer_snapshots":      ss.get("layer_snapshots", {}),
            "conditions":           ss.get("conditions", {}),
        })

    # Merge strategy: keep original ID only if it doesn't exist locally
    if strategy == "merge":
        orig_id = file_info.get("original_id")
        if orig_id and orig_id not in _load_index()["files"]:
            save_body["id"] = orig_id

    # Carry rank through if present in the export
    if "rank" in file_info:
        save_body["rank"] = file_info["rank"]

    return save_file(save_body)


# ── Command hierarchy ─────────────────────────────────────────────────────────
#
# A file's `parent_file_id` points to a commanding file with a HIGHER rank.
# These helpers walk that graph in both directions so a higher-ranked planner
# can see what subordinate units have planned, and a subordinate can trace
# their chain of command up to division level.

class HierarchyError(ValueError):
    """Raised when a parent link would create a cycle or invert rank."""


def _validate_parent_link(
    index: dict[str, Any],
    *,
    child_id: str,
    child_rank: int,
    parent_id: Any,
) -> str | None:
    """Validate a candidate parent link before persisting it.

    Rules:
      • parent_id may be None (top-level file with no commander)
      • parent must exist in the index
      • parent must outrank the child (parent.rank > child.rank)
      • no cycle: the child must not appear in the parent's ancestor chain
      • a file cannot be its own parent

    Returns the validated parent_id (possibly None) on success.
    Raises HierarchyError if the link is invalid.
    """
    if parent_id in (None, "", "null"):
        return None
    if not isinstance(parent_id, str):
        raise HierarchyError("parent_file_id must be a string")
    if parent_id == child_id:
        raise HierarchyError("a file cannot be its own parent")

    parent = index["files"].get(parent_id)
    if parent is None:
        raise HierarchyError(f"parent file '{parent_id}' does not exist")

    parent_rank = _clamp_rank(parent.get("rank", RANK_DEFAULT))
    if parent_rank <= child_rank:
        raise HierarchyError(
            f"parent rank ({parent_rank}) must be greater than child rank ({child_rank})"
        )

    # Walk the parent's ancestor chain. If we ever hit child_id, that's a cycle.
    cursor: str | None = parent.get("parent_file_id")
    seen: set[str] = {parent_id}
    while cursor:
        if cursor == child_id:
            raise HierarchyError("cycle detected — child appears in parent's ancestry")
        if cursor in seen:
            # Pre-existing cycle in stored data — abort to avoid infinite loop
            raise HierarchyError("pre-existing cycle in ancestor chain")
        seen.add(cursor)
        ancestor = index["files"].get(cursor)
        if ancestor is None:
            break
        cursor = ancestor.get("parent_file_id")

    return parent_id


def list_ancestors(file_id: str) -> list[dict[str, Any]]:
    """Walk parent_file_id from the given file up to the root commander.

    Returns ordered list: [immediate parent, ..., root commander].
    Empty list if the file has no parent or does not exist.
    Cycles in pre-existing data are tolerated (capped at 32 levels).
    """
    index = _load_index()
    self_meta = index["files"].get(file_id)
    if self_meta is None:
        return []

    chain: list[dict[str, Any]] = []
    cursor: str | None = self_meta.get("parent_file_id")
    seen: set[str] = {file_id}
    while cursor and len(chain) < 32:
        if cursor in seen:
            break  # cycle safety
        seen.add(cursor)
        ancestor = index["files"].get(cursor)
        if ancestor is None:
            break
        chain.append(ancestor)
        cursor = ancestor.get("parent_file_id")
    return chain


def list_descendants(file_id: str, recursive: bool = True) -> list[dict[str, Any]]:
    """All subordinate files of the given file.

    With recursive=True (default), walks the full subtree breadth-first.
    With recursive=False, returns only immediate children.
    """
    index = _load_index()
    if file_id not in index["files"]:
        return []

    files = list(index["files"].values())
    children_of: dict[str, list[dict[str, Any]]] = {}
    for f in files:
        pid = f.get("parent_file_id")
        if pid:
            children_of.setdefault(pid, []).append(f)

    if not recursive:
        return children_of.get(file_id, [])

    out: list[dict[str, Any]] = []
    queue: list[str] = [file_id]
    seen: set[str] = {file_id}
    while queue:
        current_id = queue.pop(0)
        for child in children_of.get(current_id, []):
            cid = child["id"]
            if cid in seen:
                continue  # cycle safety
            seen.add(cid)
            out.append(child)
            queue.append(cid)
    return out


def list_siblings(file_id: str) -> list[dict[str, Any]]:
    """Files that share the same parent_file_id (peer units under one commander).

    Returns an empty list for root files (no shared parent) and excludes self.
    """
    index = _load_index()
    self_meta = index["files"].get(file_id)
    if self_meta is None:
        return []
    parent_id = self_meta.get("parent_file_id")
    if not parent_id:
        return []
    return [
        f for f in index["files"].values()
        if f.get("parent_file_id") == parent_id and f["id"] != file_id
    ]


def get_hierarchy(file_id: str) -> dict[str, Any] | None:
    """Bundle the full command picture around a single file.

    Returns:
      {
        self:        FsFileMeta,
        ancestors:   FsFileMeta[]  ordered immediate-parent → root
        descendants: FsFileMeta[]  all subordinates, BFS order
        siblings:    FsFileMeta[]  peers under the same commander
      }
    Returns None if the file does not exist.
    """
    self_meta = get_file_meta(file_id)
    if self_meta is None:
        return None
    return {
        "self":        self_meta,
        "ancestors":   list_ancestors(file_id),
        "descendants": list_descendants(file_id, recursive=True),
        "siblings":    list_siblings(file_id),
    }


def update_file_metadata(file_id: str, body: dict[str, Any]) -> dict[str, Any] | None:
    """Patch hierarchy/identity fields without touching the file content.

    Accepts any subset of: rank, unit, commander_name, parent_file_id.
    Validates parent linkage before persisting.
    Mirrors the changes into the content file so subsequent opens see them.
    """
    index = _load_index()
    meta = index["files"].get(file_id)
    if meta is None:
        return None

    if "rank" in body:
        meta["rank"] = _clamp_rank(body["rank"])
    if "unit" in body:
        meta["unit"] = (body.get("unit") or "").strip()
    if "commander_name" in body:
        meta["commander_name"] = (body.get("commander_name") or "").strip()
    if "parent_file_id" in body:
        meta["parent_file_id"] = _validate_parent_link(
            index,
            child_id=file_id,
            child_rank=_clamp_rank(meta.get("rank", RANK_DEFAULT)),
            parent_id=body.get("parent_file_id"),
        )

    meta["updated_at"] = _now()
    _save_index(index)

    # Mirror into the content file so a subsequent open reflects the change
    path = CONTENT_DIR / f"{file_id}.json"
    if path.exists():
        try:
            content = json.loads(path.read_text())
            for key in ("rank", "unit", "commander_name", "parent_file_id"):
                if key in meta:
                    content[key] = meta[key]
            content["updated_at"] = meta["updated_at"]
            path.write_text(json.dumps(content))
        except (json.JSONDecodeError, OSError):
            pass
    return meta
