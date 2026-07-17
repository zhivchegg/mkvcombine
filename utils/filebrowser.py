import os
from datetime import datetime


def safe_path(base_path, requested_path):
    """Resolve path safely, preventing path traversal."""
    if not requested_path:
        return base_path
    resolved = os.path.realpath(os.path.join(base_path, requested_path))
    if not resolved.startswith(os.path.realpath(base_path)):
        return None
    return resolved


def browse_directory(path):
    """Browse directory contents with safety checks."""
    if not os.path.isdir(path):
        return {"error": "Directory not found", "items": []}

    items = []
    try:
        entries = os.listdir(path)
    except PermissionError:
        return {"error": "Permission denied", "items": []}

    for entry in entries:
        full_path = os.path.join(path, entry)
        try:
            stat = os.stat(full_path)
            is_dir = os.path.isdir(full_path)
            items.append({
                "name": entry,
                "path": full_path,
                "is_dir": is_dir,
                "size": stat.st_size if not is_dir else None,
                "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
            })
        except (PermissionError, OSError):
            continue

    # Sort: directories first, then files alphabetically
    items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))

    parent = os.path.dirname(path)
    return {
        "current": path,
        "parent": parent if parent != path else None,
        "items": items,
    }


def format_size(size_bytes):
    """Format file size in human-readable form."""
    if size_bytes is None:
        return ""
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} PB"
