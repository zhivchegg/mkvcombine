import os
import json
import glob
import hashlib
import shutil
import subprocess
import threading
from datetime import datetime
from flask import Flask, render_template, request, jsonify, send_file

from utils.filebrowser import browse_directory, safe_path, format_size

app = Flask(__name__)

# --- State ---
processing = {
    "active": False,
    "should_stop": False,
    "current_file": "",
    "progress": 0,
    "total": 0,
    "success": 0,
    "warnings": 0,
    "errors": 0,
    "log_file": "",
    "started_at": "",
}

LOGS_DIR = "/app/logs"
MAX_LOG_SESSIONS = 5
PREVIEW_DIR = "/tmp/mkv-preview"


def rotate_logs():
    logs = sorted(glob.glob(os.path.join(LOGS_DIR, "session_*.log")))
    while len(logs) >= MAX_LOG_SESSIONS:
        try:
            os.remove(logs.pop(0))
        except OSError:
            pass


def write_log(log_file, message, level="info"):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] [{level.upper()}] {message}\n"
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(line)


def scan_serial_dir(serial_dir):
    """Scan a serial directory for MKV files and matching audio/subtitle tracks."""
    if not os.path.isdir(serial_dir):
        return {"error": "Directory not found"}

    videos = sorted([
        f for f in os.listdir(serial_dir)
        if f.lower().endswith(".mkv") and os.path.isfile(os.path.join(serial_dir, f))
    ])

    AUDIO_EXT = (".mka", ".m4a", ".aac", ".ac3", ".eac3", ".dts")
    SUB_EXT = (".ass", ".srt", ".sup", ".ssa", ".vtt")

    audio_tracks = {}
    subtitle_tracks = {}

    def get_track_name(root):
        dub_name = os.path.basename(root)
        parent_name = os.path.basename(os.path.dirname(root))
        if parent_name and parent_name not in (".", os.path.basename(serial_dir)):
            dub_name = f"{parent_name} / {dub_name}"
        return dub_name

    for root, dirs, files in os.walk(serial_dir):
        if root == serial_dir:
            continue
        # Skip hidden and system directories
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        basename = os.path.basename(root)
        if basename.startswith('.'):
            continue
        audios = sorted([f for f in files if f.lower().endswith(AUDIO_EXT)])
        subs = sorted([f for f in files if f.lower().endswith(SUB_EXT)])
        if audios or subs:
            name = get_track_name(root)
            if audios:
                audio_tracks[name] = [{"filename": f, "path": os.path.join(root, f)} for f in audios]
            if subs:
                subtitle_tracks[name] = [{"filename": f, "path": os.path.join(root, f)} for f in subs]

    all_dub_names = sorted(set(list(audio_tracks.keys()) + list(subtitle_tracks.keys())))

    def match_tracks(video_name, track_dict):
        matched = []
        for track_name, files in track_dict.items():
            for f_info in files:
                base = os.path.splitext(f_info["filename"])[0]
                if base.startswith(video_name):
                    matched.append({
                        "track_name": track_name,
                        "filename": f_info["filename"],
                        "path": f_info["path"],
                    })
                    break
        return matched

    result_videos = []
    for idx, video_file in enumerate(videos):
        video_name = os.path.splitext(video_file)[0]
        matched_audio = match_tracks(video_name, audio_tracks)
        matched_subs = match_tracks(video_name, subtitle_tracks)
        # Add IDs and default flags
        for i, t in enumerate(matched_audio):
            t["id"] = f"a{idx}_{i}"
            t["default"] = (i == 0)
        for i, t in enumerate(matched_subs):
            t["id"] = f"s{idx}_{i}"
            t["default"] = (i == 0)
        result_videos.append({
            "filename": video_file,
            "path": os.path.join(serial_dir, video_file),
            "audio_tracks": matched_audio,
            "subtitle_tracks": matched_subs,
        })

    return {
        "dir": serial_dir,
        "videos": result_videos,
        "dub_names": all_dub_names,
        "total_videos": len(videos),
        "total_audio_dubs": len(audio_tracks),
        "total_subtitle_dubs": len(subtitle_tracks),
    }


def get_mkv_track_info(filepath):
    """Get track info from an MKV file using mkvmerge --identify."""
    if not os.path.isfile(filepath):
        return {"error": "File not found"}
    try:
        result = subprocess.run(
            ["mkvmerge", "--identify", "--identification-format", "json", filepath],
            capture_output=True, text=True, timeout=60
        )
        data = json.loads(result.stdout)
        tracks = []
        for t in data.get("tracks", []):
            props = t.get("properties", {})
            track_type = t.get("type", "")
            lang = props.get("language", "und")
            track_name = props.get("track_name", "")
            default = props.get("default_track", False)
            tracks.append({
                "id": t.get("id"),
                "type": track_type,
                "codec": props.get("codec_id", ""),
                "language": lang,
                "track_name": track_name,
                "default": default,
            })
        return {"tracks": tracks, "file": os.path.basename(filepath)}
    except Exception as e:
        return {"error": str(e)}


def process_files(serial_dir, output_dir, overwrite, selected_audio=None, selected_subs=None, default_audio=None, default_subs=None, subs_no_default=False):
    """Main processing function: merge selected tracks into each video."""
    global processing

    rotate_logs()
    session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = os.path.join(LOGS_DIR, f"session_{session_id}.log")
    processing["log_file"] = log_file
    processing["started_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    write_log(log_file, f"=== Processing started ===")
    write_log(log_file, f"Serial dir: {serial_dir}")
    write_log(log_file, f"Output dir: {output_dir}")
    write_log(log_file, f"Overwrite: {overwrite}")

    scan = scan_serial_dir(serial_dir)
    if "error" in scan:
        write_log(log_file, f"Error scanning directory: {scan['error']}", "error")
        processing["active"] = False
        return

    videos = scan["videos"]
    processing["total"] = len(videos)
    processing["progress"] = 0
    processing["success"] = 0
    processing["warnings"] = 0
    processing["errors"] = 0

    if not videos:
        write_log(log_file, "No MKV files found", "warning")
        processing["active"] = False
        return

    write_log(log_file, f"Found {len(videos)} MKV files")

    for i, video in enumerate(videos):
        if processing["should_stop"]:
            write_log(log_file, "Processing stopped by user", "warning")
            break

        video_file = video["filename"]
        video_path = video["path"]

        # Filter tracks by selection
        audio_tracks = video.get("audio_tracks", [])
        subtitle_tracks = video.get("subtitle_tracks", [])

        if selected_audio is not None:
            audio_tracks = [t for t in audio_tracks if t["track_name"] in selected_audio]
        if selected_subs is not None:
            subtitle_tracks = [t for t in subtitle_tracks if t["track_name"] in selected_subs]

        processing["current_file"] = video_file
        processing["progress"] = i

        if not audio_tracks and not subtitle_tracks:
            write_log(log_file, f"No tracks found for: {video_file}", "warning")
            processing["warnings"] += 1
            continue

        write_log(log_file, f"Merging: {video_file} ({len(audio_tracks)} audio, {len(subtitle_tracks)} subs)")

        if overwrite:
            tmp_dir = output_dir if output_dir else "/tmp"
            os.makedirs(tmp_dir, exist_ok=True)
            output_path = os.path.join(tmp_dir, video_file + ".tmp")
        else:
            os.makedirs(output_dir, exist_ok=True)
            output_path = os.path.join(output_dir, video_file)

        cmd = [
            "mkvmerge", "-o", output_path,
            "--no-buttons", "--no-attachments",
            video_path,
        ]

        # Add audio tracks
        for j, track in enumerate(audio_tracks):
            is_default = (default_audio and track["track_name"] == default_audio) or (not default_audio and j == 0)
            cmd.extend([
                "--track-name", f"0:{track['track_name']}",
                "--language", "0:rus",
                "--default-track", f"0:{'yes' if is_default else 'no'}",
                track["path"],
            ])

        # Add subtitle tracks
        for j, track in enumerate(subtitle_tracks):
            if subs_no_default:
                is_default = False
            else:
                is_default = (default_subs and track["track_name"] == default_subs) or (not default_subs and j == 0)
            cmd.extend([
                "--track-name", f"0:{track['track_name']}",
                "--language", "0:rus",
                "--default-track", f"0:{'yes' if is_default else 'no'}",
                track["path"],
            ])

        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=1200
            )
            mkv_output = (result.stdout + "\n" + result.stderr).strip()

            if result.returncode == 0:
                if overwrite:
                    backup = video_path + ".bak"
                    try:
                        shutil.move(video_path, backup)
                        shutil.move(output_path, video_path)
                        os.remove(backup)
                        write_log(log_file, f"Success (overwritten): {video_file}", "success")
                    except OSError as e:
                        final_path = os.path.join(os.path.dirname(output_path), video_file)
                        if output_path != final_path:
                            shutil.move(output_path, final_path)
                        write_log(log_file, f"Cannot overwrite {video_file}: {e}. Saved to {final_path}", "warning")
                        processing["warnings"] += 1
                else:
                    write_log(log_file, f"Success: {video_file} -> {output_path}", "success")
                processing["success"] += 1

            elif result.returncode == 1:
                warning_lines = [l for l in mkv_output.split("\n") if l.strip().startswith("Warning:")]
                warn_summary = "; ".join(warning_lines[:3]) if warning_lines else "mkvmerge warnings"
                if overwrite:
                    backup = video_path + ".bak"
                    try:
                        shutil.move(video_path, backup)
                        shutil.move(output_path, video_path)
                        os.remove(backup)
                        write_log(log_file, f"Success with warnings (overwritten): {video_file} — {warn_summary}", "warning")
                    except OSError as e:
                        final_path = os.path.join(os.path.dirname(output_path), video_file)
                        if output_path != final_path:
                            shutil.move(output_path, final_path)
                        write_log(log_file, f"Cannot overwrite {video_file}: {e}. Saved to {final_path} — {warn_summary}", "warning")
                        processing["warnings"] += 1
                else:
                    write_log(log_file, f"Success with warnings: {video_file} -> {output_path} — {warn_summary}", "warning")
                processing["success"] += 1
                processing["warnings"] += 1
            else:
                write_log(log_file, f"Error for {video_file}: {mkv_output}", "error")
                processing["errors"] += 1
                if overwrite and os.path.exists(output_path):
                    os.remove(output_path)

        except subprocess.TimeoutExpired:
            write_log(log_file, f"Timeout processing {video_file}", "error")
            processing["errors"] += 1
            if overwrite and os.path.exists(output_path):
                os.remove(output_path)
        except Exception as e:
            write_log(log_file, f"Exception processing {video_file}: {e}", "error")
            processing["errors"] += 1
            if overwrite and os.path.exists(output_path):
                os.remove(output_path)

    processing["progress"] = processing["total"]
    processing["current_file"] = ""
    processing["active"] = False

    write_log(log_file, f"=== Processing complete ===")
    write_log(log_file, f"Success: {processing['success']}, Warnings: {processing['warnings']}, Errors: {processing['errors']}")


# --- Routes ---

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/browse", methods=["POST"])
def api_browse():
    data = request.json or {}
    base = data.get("base", "/")
    path = data.get("path", "")

    allowed_roots = ["/video", "/audio", "/output", "/"]
    real_base = None
    for root in allowed_roots:
        if os.path.realpath(base).startswith(os.path.realpath(root)):
            real_base = os.path.realpath(base)
            break

    if not real_base:
        for root in ["/video", "/audio", "/output"]:
            if os.path.isdir(root):
                real_base = root
                break
        else:
            real_base = "/"

    target = safe_path(real_base, path) if path else real_base
    if target is None:
        return jsonify({"error": "Invalid path"}), 400

    result = browse_directory(target)
    for item in result.get("items", []):
        item["size_fmt"] = format_size(item.get("size"))
    return jsonify(result)


@app.route("/api/scan", methods=["POST"])
def api_scan():
    data = request.json or {}
    serial_dir = data.get("dir", "")

    if not serial_dir or not os.path.isdir(serial_dir):
        return jsonify({"error": "Directory not found"}), 400

    result = scan_serial_dir(serial_dir)
    for video in result.get("videos", []):
        for track in video.get("audio_tracks", []):
            try:
                track["size"] = format_size(os.path.getsize(track["path"]))
            except OSError:
                track["size"] = "?"
        for track in video.get("subtitle_tracks", []):
            try:
                track["size"] = format_size(os.path.getsize(track["path"]))
            except OSError:
                track["size"] = "?"
    return jsonify(result)


@app.route("/api/mkdir", methods=["POST"])
def api_mkdir():
    data = request.json or {}
    path = data.get("path", "")
    if not path:
        return jsonify({"error": "Path required"}), 400
    allowed = ["/video", "/output"]
    real = os.path.realpath(path)
    if not any(real.startswith(os.path.realpath(a)) for a in allowed):
        return jsonify({"error": "Cannot create directory here"}), 403
    try:
        os.makedirs(path, exist_ok=True)
        return jsonify({"status": "created", "path": path})
    except OSError as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/files", methods=["POST"])
def api_files():
    """List MKV files in a directory (recursively) with track info."""
    data = request.json or {}
    directory = data.get("dir", "")
    if not directory or not os.path.isdir(directory):
        return jsonify({"error": "Directory not found"}), 400

    files = []
    for root, dirs, filenames in os.walk(directory):
        # Skip hidden directories
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for f in sorted(filenames):
            if f.lower().endswith(".mkv"):
                fpath = os.path.join(root, f)
                rel = os.path.relpath(fpath, directory)
                files.append({
                    "filename": f,
                    "path": fpath,
                    "relative": rel,
                    "size": format_size(os.path.getsize(fpath)),
                })
    files.sort(key=lambda x: x["relative"])
    return jsonify({"dir": directory, "files": files})


@app.route("/api/track-info", methods=["POST"])
def api_track_info():
    """Get track information from an MKV file."""
    data = request.json or {}
    filepath = data.get("path", "")
    if not filepath:
        return jsonify({"error": "Path required"}), 400
    result = get_mkv_track_info(filepath)
    return jsonify(result)


@app.route("/api/set-default-track", methods=["POST"])
def api_set_default_track():
    """Change the default track in an MKV file using mkvpropedit."""
    data = request.json or {}
    filepath = data.get("path", "")
    track_id = data.get("track_id")
    track_type = data.get("type", "audio")  # "audio" or "subtitles"

    if not filepath or track_id is None:
        return jsonify({"error": "path and track_id required"}), 400
    if not os.path.isfile(filepath):
        return jsonify({"error": "File not found"}), 404

    try:
        # First, unset all defaults of this type
        info = get_mkv_track_info(filepath)
        if "error" in info:
            return jsonify(info), 500

        for t in info.get("tracks", []):
            if t["type"] == track_type and t["default"]:
                # mkvpropedit uses 1-based track numbers, mkvmerge IDs are 0-based
                subprocess.run(
                    ["mkvpropedit", filepath, "--edit", f"track:{t['id'] + 1}", "--set", "flag-default=0"],
                    capture_output=True, text=True, timeout=30
                )

        # Then set the selected track as default
        # mkvpropedit uses 1-based track numbers, mkvmerge IDs are 0-based
        result = subprocess.run(
            ["mkvpropedit", filepath, "--edit", f"track:{track_id + 1}", "--set", "flag-default=1"],
            capture_output=True, text=True, timeout=30
        )

        if result.returncode != 0:
            return jsonify({"error": result.stderr or "mkvpropedit failed"}), 500

        return jsonify({"status": "ok", "file": os.path.basename(filepath), "track_id": track_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/set-default-track-bulk", methods=["POST"])
def api_set_default_track_bulk():
    """Change the default track in all MKV files in a directory by language+codec or track name."""
    data = request.json or {}
    directory = data.get("dir", "")
    track_type = data.get("type", "audio")
    track_name = data.get("track_name", "")
    language = data.get("language", "")
    codec = data.get("codec", "")

    if not directory:
        return jsonify({"error": "dir required"}), 400
    if not track_name and not language:
        return jsonify({"error": "track_name or language required"}), 400
    if not os.path.isdir(directory):
        return jsonify({"error": "Directory not found"}), 404

    # Collect all MKV files in the directory
    mkv_files = sorted([
        os.path.join(directory, f) for f in os.listdir(directory)
        if f.lower().endswith(".mkv") and os.path.isfile(os.path.join(directory, f))
    ])

    if not mkv_files:
        return jsonify({"error": "No MKV files found in directory"}), 400

    processed = 0
    skipped = 0
    errors = 0
    details = []

    for filepath in mkv_files:
        filename = os.path.basename(filepath)
        try:
            info = get_mkv_track_info(filepath)
            if "error" in info:
                errors += 1
                details.append({"file": filename, "status": "error", "reason": info["error"]})
                continue

            # Find matching track: prefer name match, fallback to language+codec
            mkv_track = None
            for t in info.get("tracks", []):
                if t["type"] != track_type:
                    continue
                if track_name and t.get("track_name") == track_name:
                    mkv_track = t
                    break
            if not mkv_track and language:
                for t in info.get("tracks", []):
                    if t["type"] != track_type:
                        continue
                    if t.get("language") == language:
                        if not codec or t.get("codec") == codec:
                            mkv_track = t
                            break

            if not mkv_track:
                skipped += 1
                details.append({"file": filename, "status": "skipped", "reason": "track not found"})
                continue

            # Skip if already default
            if mkv_track.get("default"):
                processed += 1
                details.append({"file": filename, "status": "ok", "reason": "already default"})
                continue

            # Unset all defaults of this type
            # mkvpropedit uses 1-based track numbers, mkvmerge IDs are 0-based
            for t in info.get("tracks", []):
                if t["type"] == track_type and t["default"]:
                    subprocess.run(
                        ["mkvpropedit", filepath, "--edit", f"track:{t['id'] + 1}", "--set", "flag-default=0"],
                        capture_output=True, text=True, timeout=30
                    )

            # Set selected track as default
            result = subprocess.run(
                ["mkvpropedit", filepath, "--edit", f"track:{mkv_track['id'] + 1}", "--set", "flag-default=1"],
                capture_output=True, text=True, timeout=30
            )

            if result.returncode != 0:
                errors += 1
                details.append({"file": filename, "status": "error", "reason": result.stderr or "mkvpropedit failed"})
            else:
                processed += 1
                details.append({"file": filename, "status": "ok"})
        except Exception as e:
            errors += 1
            details.append({"file": filename, "status": "error", "reason": str(e)})

    return jsonify({
        "status": "ok",
        "processed": processed,
        "skipped": skipped,
        "errors": errors,
        "details": details,
    })


@app.route("/api/disable-subs-bulk", methods=["POST"])
def api_disable_subs_bulk():
    """Remove default flag from all subtitle tracks in MKV files (tracks stay selectable)."""
    data = request.json or {}
    directory = data.get("dir", "")

    if not directory:
        return jsonify({"error": "dir required"}), 400
    if not os.path.isdir(directory):
        return jsonify({"error": "Directory not found"}), 404

    mkv_files = sorted([
        os.path.join(directory, f) for f in os.listdir(directory)
        if f.lower().endswith(".mkv") and os.path.isfile(os.path.join(directory, f))
    ])

    if not mkv_files:
        return jsonify({"error": "No MKV files found"}), 400

    processed = 0
    skipped = 0
    errors = 0
    details = []

    for filepath in mkv_files:
        filename = os.path.basename(filepath)
        try:
            info = get_mkv_track_info(filepath)
            if "error" in info:
                errors += 1
                details.append({"file": filename, "status": "error", "reason": info["error"]})
                continue

            subs = [t for t in info.get("tracks", []) if t["type"] == "subtitles"]
            if not subs:
                skipped += 1
                details.append({"file": filename, "status": "skipped", "reason": "no subtitles"})
                continue

            # Re-enable tracks and remove default flag (subs stay selectable, just not auto-on)
            for t in subs:
                subprocess.run(
                    ["mkvpropedit", filepath,
                     "--edit", f"track:{t['id'] + 1}", "--set", "flag-enabled=1",
                     "--edit", f"track:{t['id'] + 1}", "--set", "flag-default=0"],
                    capture_output=True, text=True, timeout=30
                )

            processed += 1
            details.append({"file": filename, "status": "ok"})
        except Exception as e:
            errors += 1
            details.append({"file": filename, "status": "error", "reason": str(e)})

    return jsonify({
        "status": "ok",
        "processed": processed,
        "skipped": skipped,
        "errors": errors,
        "details": details,
    })


@app.route("/api/extract-audio", methods=["POST"])
def api_extract_audio():
    """Extract and transcode a single audio track from MKV to AAC for browser playback."""
    data = request.json or {}
    filepath = data.get("path", "")
    track_id = data.get("track_id")

    if not filepath or track_id is None:
        return jsonify({"error": "path and track_id required"}), 400
    if not os.path.isfile(filepath):
        return jsonify({"error": "File not found"}), 404

    # Generate a stable cache key from file path + track id
    cache_key = hashlib.md5(f"{filepath}:{track_id}".encode()).hexdigest()
    ext = ".aac"

    os.makedirs(PREVIEW_DIR, exist_ok=True)
    out_path = os.path.join(PREVIEW_DIR, f"{cache_key}{ext}")

    # Return cached if exists
    if os.path.isfile(out_path):
        return jsonify({"status": "ok", "audio_url": f"/api/audio-file/{cache_key}{ext}"})

    try:
        # Use ffmpeg to transcode to AAC (browser-compatible)
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", filepath,
             "-map", f"0:{track_id}",
             "-c:a", "aac", "-b:a", "192k", "-ac", "2",
             "-movflags", "+faststart",
             out_path],
            capture_output=True, text=True, timeout=120
        )
        if not os.path.isfile(out_path):
            return jsonify({"error": result.stderr[-500:] if result.stderr else "Extraction failed"}), 500

        return jsonify({"status": "ok", "audio_url": f"/api/audio-file/{cache_key}{ext}"})
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Extraction timeout"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/remux-video", methods=["POST"])
def api_remux_video():
    """Remux MKV to MP4 with selected audio track for browser playback."""
    data = request.json or {}
    filepath = data.get("path", "")
    audio_track_id = data.get("audio_track_id")

    if not filepath or audio_track_id is None:
        return jsonify({"error": "path and audio_track_id required"}), 400
    if not os.path.isfile(filepath):
        return jsonify({"error": "File not found"}), 404

    # Cache key: file + audio track
    cache_key = hashlib.md5(f"{filepath}:audio:{audio_track_id}".encode()).hexdigest()
    out_path = os.path.join(PREVIEW_DIR, f"{cache_key}.mp4")

    os.makedirs(PREVIEW_DIR, exist_ok=True)

    # Return cached if exists
    if os.path.isfile(out_path):
        return jsonify({"status": "ok", "video_url": f"/api/remuxed-file/{cache_key}.mp4"})

    # Check audio codec to decide copy vs transcode
    info = get_mkv_track_info(filepath)
    audio_codec = ""
    if "tracks" in info:
        for t in info["tracks"]:
            if t["id"] == audio_track_id and t["type"] == "audio":
                audio_codec = t.get("codec", "")
                break

    # Browser-compatible audio codecs: AAC, Opus, Vorbis, FLAC, MP3
    # AC3, DTS, EAC3 need transcoding
    needs_transcode = any(c in audio_codec for c in ("AC3", "DTS", "EAC3", "TrueHD"))
    audio_args = ["-c:a", "aac", "-b:a", "192k", "-ac", "2"] if needs_transcode else ["-c:a", "copy"]

    try:
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", filepath,
             "-map", "0:v:0", "-map", f"0:{audio_track_id}",
             "-c:v", "copy"] + audio_args + [
             "-movflags", "+faststart",
             "-f", "mp4",
             out_path],
            capture_output=True, text=True, timeout=600
        )
        if not os.path.isfile(out_path):
            return jsonify({"error": result.stderr[-500:] if result.stderr else "Remux failed"}), 500

        return jsonify({"status": "ok", "video_url": f"/api/remuxed-file/{cache_key}.mp4"})
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Remux timeout"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/remuxed-file/<path:filename>")
def api_remuxed_file(filename):
    """Serve a remuxed MP4 file."""
    safe_name = os.path.basename(filename)
    filepath = os.path.join(PREVIEW_DIR, safe_name)
    if not os.path.isfile(filepath):
        return jsonify({"error": "File not found"}), 404
    return send_file(filepath, mimetype="video/mp4", conditional=True)


@app.route("/api/audio-file/<path:filename>")
def api_audio_file(filename):
    """Serve an extracted audio file for preview."""
    # Security: only serve from PREVIEW_DIR, no path traversal
    safe_name = os.path.basename(filename)
    filepath = os.path.join(PREVIEW_DIR, safe_name)
    if not os.path.isfile(filepath):
        return jsonify({"error": "File not found"}), 404

    # Detect mimetype from extension
    ext = os.path.splitext(safe_name)[1].lower()
    mime_map = {
        ".aac": "audio/aac",
        ".ac3": "audio/ac3",
        ".dts": "audio/vnd.dts",
        ".flac": "audio/flac",
        ".mka": "audio/x-matroska",
        ".opus": "audio/opus",
        ".ogg": "audio/ogg",
    }
    mimetype = mime_map.get(ext, "audio/mpeg")

    return send_file(filepath, mimetype=mimetype, conditional=True)


@app.route("/api/video/<path:filepath>")
def api_serve_video(filepath):
    """Serve a video file for the web player with range request support."""
    # Flask strips leading slash, restore it
    if not filepath.startswith("/"):
        filepath = "/" + filepath
    # Security: only serve from /video or /output
    real = os.path.realpath(filepath)
    if not (real.startswith(os.path.realpath("/video")) or real.startswith(os.path.realpath("/output"))):
        return jsonify({"error": "Access denied"}), 403
    if not os.path.isfile(real):
        return jsonify({"error": "File not found"}), 404
    return send_file(real, mimetype="video/x-matroska", conditional=True)


@app.route("/api/start", methods=["POST"])
def api_start():
    global processing

    if processing["active"]:
        return jsonify({"error": "Processing already in progress"}), 409

    data = request.json or {}
    serial_dir = data.get("serial_dir", "")
    output_dir = data.get("output_dir", "/output")
    overwrite = data.get("overwrite", False)
    selected_audio = data.get("selected_audio")  # list of track names or None (all)
    selected_subs = data.get("selected_subs")
    default_audio = data.get("default_audio")  # track name to set as default
    default_subs = data.get("default_subs")
    subs_no_default = data.get("subs_no_default", False)

    if not serial_dir or not os.path.isdir(serial_dir):
        return jsonify({"error": "Invalid serial directory"}), 400

    if not overwrite:
        os.makedirs(output_dir, exist_ok=True)

    processing.update({
        "active": True,
        "should_stop": False,
        "current_file": "",
        "progress": 0,
        "total": 0,
        "success": 0,
        "warnings": 0,
        "errors": 0,
        "log_file": "",
        "started_at": "",
    })

    thread = threading.Thread(
        target=process_files,
        args=(serial_dir, output_dir, overwrite, selected_audio, selected_subs, default_audio, default_subs, subs_no_default),
        daemon=True,
    )
    thread.start()

    return jsonify({"status": "started"})


@app.route("/api/stop", methods=["POST"])
def api_stop():
    processing["should_stop"] = True
    return jsonify({"status": "stopping"})


@app.route("/api/status")
def api_status():
    return jsonify({
        "active": processing["active"],
        "current_file": processing["current_file"],
        "progress": processing["progress"],
        "total": processing["total"],
        "success": processing["success"],
        "warnings": processing["warnings"],
        "errors": processing["errors"],
        "percent": int(processing["progress"] / max(processing["total"], 1) * 100),
        "started_at": processing["started_at"],
    })


@app.route("/api/logs")
def api_logs():
    sessions = []
    for f in sorted(glob.glob(os.path.join(LOGS_DIR, "session_*.log")), reverse=True):
        sessions.append({
            "name": os.path.basename(f),
            "path": f,
            "size": os.path.getsize(f),
        })

    selected = request.args.get("file")
    content = ""
    if selected:
        safe = os.path.join(LOGS_DIR, os.path.basename(selected))
        if os.path.isfile(safe):
            with open(safe, "r", encoding="utf-8") as f:
                content = f.read()
    elif sessions:
        latest = sessions[0]["path"]
        if os.path.isfile(latest):
            with open(latest, "r", encoding="utf-8") as f:
                content = f.read()

    return jsonify({"sessions": sessions, "content": content})


if __name__ == "__main__":
    os.makedirs(LOGS_DIR, exist_ok=True)
    # Clean old preview files on startup
    if os.path.isdir(PREVIEW_DIR):
        shutil.rmtree(PREVIEW_DIR, ignore_errors=True)
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    app.run(host="0.0.0.0", port=5000, debug=False)
