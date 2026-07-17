# MKV Merger Pro

Batch merge external audio tracks (MKA, AAC, AC3, DTS) and subtitles (ASS, SRT) into MKV video files. Designed for NAS servers (QNAP, Synology, Unraid) and home media servers.

> **Note:** The UI is in Russian. English localization is planned.

## Features

- **Batch processing** — merge audio/subtitle tracks into multiple MKV files at once
- **Auto-matching** — automatically matches audio/subtitle files to videos by filename
- **Track preview** — listen to audio tracks directly in the browser (transcoded to AAC)
- **Video playback** — built-in player with remuxed MP4 output for universal browser support
- **Default track management** — set default audio/subtitle tracks per file or in bulk
- **Subtitle control** — disable subtitles by default while keeping them selectable
- **Overwrite mode** — replace original files with temp-file swap (safe atomic replacement)
- **Directory browser** — built-in file manager for selecting directories
- **Session logs** — processing logs with rotation (keeps last 5 sessions)

## Quick Start

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/mkv-merge-pro.git
cd mkv-merge-pro

# Create .env file
cp .env.example .env
# Edit .env — set VIDEO_DIR and OUTPUT_DIR to your paths

# Build and run
docker compose up -d

# Open in browser
open http://localhost:5000
```

## Directory Structure

The app expects this directory layout inside the container:

```
/video/
  ├── Series Name/
  │   ├── Episode 01.mkv          # Video files
  │   ├── Episode 02.mkv
  │   ├── Dub Studio/             # Audio tracks (subdirectory)
  │   │   ├── Episode 01.mka
  │   │   └── Episode 02.mka
  │   └── Subs/                   # Subtitle tracks (subdirectory)
  │       ├── Episode 01.srt
  │       └── Episode 02.srt
  └── Another Series/
      └── ...
```

Audio/subtitle files are matched to videos by filename prefix. For example, `Episode 01.mka` matches `Episode 01.mkv`.

## Supported Formats

**Video:** MKV (H.264, H.265, VP9, AV1)

**Audio:** MKA, M4A, AAC, AC3, EAC3, DTS, FLAC, Opus, Vorbis

**Subtitles:** ASS, SRT, SUP, SSA, VTT

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/browse` | POST | Directory listing |
| `/api/scan` | POST | Scan directory for videos + matching tracks |
| `/api/start` | POST | Start batch processing |
| `/api/stop` | POST | Stop processing |
| `/api/status` | GET | Processing progress |
| `/api/logs` | GET | Session logs |
| `/api/files` | POST | List MKV files in directory |
| `/api/track-info` | POST | Get track metadata from MKV |
| `/api/extract-audio` | POST | Extract + transcode audio to AAC |
| `/api/remux-video` | POST | Remux MKV to MP4 with selected audio |
| `/api/set-default-track` | POST | Set default track for single file |
| `/api/set-default-track-bulk` | POST | Set default track for all files in directory |
| `/api/disable-subs-bulk` | POST | Remove default flag from subtitles |

## Requirements

- Docker
- mkvtoolnix (installed in container)
- ffmpeg (installed in container)

## Configuration

Environment variables (set in `.env` or `docker-compose.yml`):

| Variable | Default | Description |
|----------|---------|-------------|
| `VIDEO_DIR` | — | Path to video files on host |
| `OUTPUT_DIR` | — | Path to output directory on host |
| `PORT` | `5000` | Web UI port |

## Architecture

```
Flask (single-file backend)
├── /api/scan → scan_serial_dir() → match tracks by filename
├── /api/start → process_files() → mkvmerge in daemon thread
├── /api/track-info → mkvmerge --identify (JSON)
├── /api/extract-audio → ffmpeg -c:a aac
├── /api/remux-video → ffmpeg -c:v copy -c:a aac
├── /api/set-default-track → mkvpropedit
└── /api/set-default-track-bulk → mkvpropedit (loop)

Frontend (vanilla JS, no framework)
├── Plyr video player
├── Built-in directory browser
├── Polling-based progress updates
└── Glassmorphism dark theme (Inter font)
```

## License

[MIT](LICENSE)
