// MKVCombine - Main Script

let pollTimer = null;
let logTimer = null;
let scanData = null;
let player = null;
let currentVideoPath = null;

// === Scan ===

async function scanDirectory() {
    const dir = document.getElementById("serialDir").value.trim();
    if (!dir) { showNotification(t("scan.select_dir"), "warning"); return; }

    const btn = document.getElementById("btnScan");
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split"></i> ' + t("scan.scanning");

    // Show shimmer placeholders
    const preview = document.getElementById("scanPreview");
    preview.style.display = "block";
    document.getElementById("scanList").innerHTML =
        '<div class="shimmer shimmer-row"></div>'.repeat(5);
    document.getElementById("scanSummary").innerHTML = '';
    document.getElementById("scanDubs").innerHTML = '';

    try {
        const res = await fetch("/api/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dir: dir }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
            showNotification(data.error || t("scan.error"), "error");
            document.getElementById("scanPreview").style.display = "none";
            return;
        }
        scanData = data;
        displayScanResults(data, dir);
    } catch (e) {
        showNotification(t("scan.network_error") + e.message, "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-search"></i> ' + t("scan.scan_btn");
    }
}

function displayScanResults(data, dir) {
    const preview = document.getElementById("scanPreview");
    const summary = document.getElementById("scanSummary");
    const dubs = document.getElementById("scanDubs");
    const list = document.getElementById("scanList");

    const totalAudio = data.videos.reduce((sum, v) => sum + v.audio_tracks.length, 0);
    const totalSubs = data.videos.reduce((sum, v) => sum + v.subtitle_tracks.length, 0);
    summary.innerHTML = `<i class="bi bi-check-circle-fill"></i> ${t("scan.found", { videos: data.total_videos, audio: totalAudio, subs: totalSubs })}`;

    dubs.innerHTML = data.dub_names.map(d => `<span class="dub-chip"><i class="bi bi-music-note-beamed" style="margin-right:4px;"></i>${escapeHtml(d)}</span>`).join("");

    // Audio track checkboxes with radio for default
    const audioSelect = document.getElementById("audioSelect");
    const audioCheckboxes = document.getElementById("audioCheckboxes");
    const audioNames = [...new Set(data.videos.flatMap(v => v.audio_tracks.map(t => t.track_name)))];

    if (audioNames.length > 0) {
        audioSelect.style.display = "block";
        audioCheckboxes.innerHTML = `
            <div style="display:flex; gap:8px; margin-bottom:8px;">
                <button onclick="toggleAllTracks('audioCheckboxes', true)" class="btn-browse" style="height:28px; padding:0 10px; font-size:0.75rem;">${t("scan.select_all")}</button>
                <button onclick="toggleAllTracks('audioCheckboxes', false)" class="btn-browse" style="height:28px; padding:0 10px; font-size:0.75rem;">${t("scan.deselect_all")}</button>
            </div>
        ` + audioNames.map((name, i) => `
            <div class="track-item">
                <label><input type="checkbox" checked data-audio-name="${escapeAttr(name)}" onchange="onAudioCheckChange(this)"> ${escapeHtml(name)}</label>
                <label style="font-size:0.75rem; color:var(--text-muted); cursor:pointer;">
                    <input type="radio" name="defaultAudio" value="${escapeAttr(name)}" ${i === 0 ? 'checked' : ''}> ${t("scan.default")}
                </label>
            </div>
        `).join("");
    } else {
        audioSelect.style.display = "none";
    }

    // Subtitle track checkboxes with radio for default
    const subsSelect = document.getElementById("subsSelect");
    const subsCheckboxes = document.getElementById("subsCheckboxes");
    const subNames = [...new Set(data.videos.flatMap(v => v.subtitle_tracks.map(t => t.track_name)))];

    if (subNames.length > 0) {
        subsSelect.style.display = "block";
        subsCheckboxes.innerHTML = `
            <div style="display:flex; gap:8px; margin-bottom:8px;">
                <button onclick="toggleAllTracks('subsCheckboxes', true)" class="btn-browse" style="height:28px; padding:0 10px; font-size:0.75rem;">${t("scan.select_all")}</button>
                <button onclick="toggleAllTracks('subsCheckboxes', false)" class="btn-browse" style="height:28px; padding:0 10px; font-size:0.75rem;">${t("scan.deselect_all")}</button>
            </div>
        ` + subNames.map((name, i) => `
            <div class="track-item">
                <label><input type="checkbox" checked data-sub-name="${escapeAttr(name)}" onchange="onSubCheckChange(this)"> ${escapeHtml(name)}</label>
                <label style="font-size:0.75rem; color:var(--text-muted); cursor:pointer;">
                    <input type="radio" name="defaultSubs" value="${escapeAttr(name)}" ${i === 0 ? 'checked' : ''}> ${t("scan.default")}
                </label>
            </div>
        `).join("") + `
            <div class="track-item" style="border-top:1px solid var(--border); margin-top:8px; padding-top:10px;">
                <label style="font-size:0.8rem; color:var(--warning); cursor:pointer;">
                    <input type="checkbox" id="subsNoDefault"> <i class="bi bi-eye-slash"></i> ${t("scan.no_subs_default")}
                </label>
            </div>
        `;
    } else {
        subsSelect.style.display = "none";
    }

    // Video list
    list.innerHTML = data.videos.map(v => {
        const parts = [];
        if (v.audio_tracks.length > 0) parts.push(`<span class="count">${v.audio_tracks.length}</span> ${t("player.audio").toLowerCase()}`);
        if (v.subtitle_tracks.length > 0) parts.push(`<span class="count">${v.subtitle_tracks.length}</span> ${t("player.subs").toLowerCase()}`);
        const trackInfo = parts.length > 0 ? `<span class="tracks">${parts.join(", ")}</span>` : `<span class="tracks" style="color:var(--warning);">${t("scan.no_tracks")}</span>`;
        return `<div class="scan-video"><i class="bi bi-film" style="color:var(--accent);"></i><span class="name">${escapeHtml(v.filename)}</span>${trackInfo}</div>`;
    }).join("");

    preview.style.display = "block";
    const outputInput = document.getElementById("outputDir");
    if (!outputInput.value) outputInput.value = dir + "/output";
    document.getElementById("playerDir").value = dir;
}

function toggleAllTracks(containerId, checked) {
    document.querySelectorAll(`#${containerId} input[type="checkbox"][data-audio-name], #${containerId} input[type="checkbox"][data-sub-name]`).forEach(cb => {
        cb.checked = checked;
        cb.dispatchEvent(new Event('change'));
    });
}

function getSelectedAudio() {
    const checked = document.querySelectorAll('#audioCheckboxes input[type="checkbox"]:checked');
    return Array.from(checked).map(el => el.dataset.audioName);
}
function getSelectedSubs() {
    const checked = document.querySelectorAll('#subsCheckboxes input[type="checkbox"]:checked');
    return Array.from(checked).map(el => el.dataset.subName);
}
function getDefaultAudio() {
    const radio = document.querySelector('input[name="defaultAudio"]:checked:not(:disabled)');
    return radio ? radio.value : null;
}
function getDefaultSubs() {
    const radio = document.querySelector('input[name="defaultSubs"]:checked:not(:disabled)');
    return radio ? radio.value : null;
}

function onAudioCheckChange(checkbox) {
    const trackItem = checkbox.closest('.track-item');
    const radio = trackItem.querySelector('input[name="defaultAudio"]');
    if (radio) {
        radio.disabled = !checkbox.checked;
        // If the unchecked track was the default, switch to first checked
        if (!checkbox.checked && radio.checked) {
            const firstChecked = document.querySelector('#audioCheckboxes input[type="checkbox"]:checked');
            if (firstChecked) {
                const firstRadio = firstChecked.closest('.track-item').querySelector('input[name="defaultAudio"]');
                if (firstRadio) firstRadio.checked = true;
            }
        }
    }
}
function onSubCheckChange(checkbox) {
    const trackItem = checkbox.closest('.track-item');
    const radio = trackItem.querySelector('input[name="defaultSubs"]');
    if (radio) {
        radio.disabled = !checkbox.checked;
        if (!checkbox.checked && radio.checked) {
            const firstChecked = document.querySelector('#subsCheckboxes input[type="checkbox"]:checked');
            if (firstChecked) {
                const firstRadio = firstChecked.closest('.track-item').querySelector('input[name="defaultSubs"]');
                if (firstRadio) firstRadio.checked = true;
            }
        }
    }
}

// === Processing ===

async function startProcessing() {
    const serialDir = document.getElementById("serialDir").value.trim();
    const outputDir = document.getElementById("outputDir").value.trim();
    const overwrite = document.getElementById("overwrite").checked;

    if (!serialDir) { showNotification(t("scan.select_dir"), "warning"); return; }
    if (!overwrite && !outputDir) { showNotification(t("controls.no_output"), "warning"); return; }

    const selectedAudio = scanData ? getSelectedAudio() : null;
    const selectedSubs = scanData ? getSelectedSubs() : null;
    const defaultAudio = scanData ? getDefaultAudio() : null;
    const defaultSubs = scanData ? getDefaultSubs() : null;
    const subsNoDefault = scanData ? (document.getElementById('subsNoDefault')?.checked || false) : false;

    try {
        const res = await fetch("/api/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                serial_dir: serialDir,
                output_dir: outputDir || "/output",
                overwrite: overwrite,
                selected_audio: selectedAudio,
                selected_subs: selectedSubs,
                default_audio: defaultAudio,
                default_subs: defaultSubs,
                subs_no_default: subsNoDefault,
            }),
        });
        const data = await res.json();
        if (!res.ok) { showNotification(data.error || t("notification.error_prefix").trim(), "error"); return; }

        document.getElementById("btnStart").disabled = true;
        document.getElementById("btnStop").disabled = false;
        document.getElementById("progressSection").classList.add("visible");
        const badge = document.getElementById("statusBadge");
        badge.className = "status-badge active";
        badge.innerHTML = '<i class="bi bi-circle-fill" style="font-size:6px;"></i> ' + t("status.processing");
        document.getElementById("logArea").innerHTML = "";

        pollStatus();
        pollTimer = setInterval(pollStatus, 1000);
        logTimer = setInterval(loadCurrentLog, 2000);
    } catch (e) { showNotification(t("scan.network_error") + e.message, "error"); }
}

async function stopProcessing() {
    try { await fetch("/api/stop", { method: "POST" }); } catch (e) { console.error(e); }
}

async function pollStatus() {
    try {
        const res = await fetch("/api/status");
        const data = await res.json();
        document.getElementById("currentFile").textContent = data.current_file || "—";
        document.getElementById("progressText").textContent = `${data.progress} / ${data.total}`;
        document.getElementById("progressBar").style.width = data.percent + "%";
        document.getElementById("progressPercent").textContent = data.percent + "%";
        document.getElementById("statSuccess").textContent = data.success;
        document.getElementById("statWarnings").textContent = data.warnings;
        document.getElementById("statErrors").textContent = data.errors;

        if (!data.active) {
            clearInterval(pollTimer); clearInterval(logTimer);
            pollTimer = null; logTimer = null;
            document.getElementById("btnStart").disabled = false;
            document.getElementById("btnStop").disabled = true;
            const badge = document.getElementById("statusBadge");
            badge.className = "status-badge done";
            badge.innerHTML = '<i class="bi bi-circle-fill" style="font-size:6px;"></i> ' + t("status.done");
            loadCurrentLog(); loadLogSessions();
            if (data.errors > 0) showNotification(t("notification.processing_errors", { count: data.errors }), "warning");
            else showNotification(t("notification.processing_done", { count: data.success }), "success");
        }
    } catch (e) { console.error(e); }
}

// === Logs ===

async function loadCurrentLog() {
    try {
        const res = await fetch("/api/logs");
        const data = await res.json();
        if (data.content) {
            const el = document.getElementById("logArea");
            el.innerHTML = formatLog(data.content);
            el.scrollTop = el.scrollHeight;
        }
    } catch (e) { console.error(e); }
}
async function loadLogSessions() {
    try {
        const res = await fetch("/api/logs");
        const data = await res.json();
        const sel = document.getElementById("logSession");
        sel.innerHTML = `<option value="">${t("logs.current_session")}</option>`;
        for (const s of data.sessions) sel.innerHTML += `<option value="${s.name}">${s.name} (${formatBytes(s.size)})</option>`;
    } catch (e) { console.error(e); }
}
async function loadLog() {
    const file = document.getElementById("logSession").value;
    if (!file) { loadCurrentLog(); return; }
    try {
        const res = await fetch(`/api/logs?file=${encodeURIComponent(file)}`);
        const data = await res.json();
        if (data.content) {
            const el = document.getElementById("logArea");
            el.innerHTML = formatLog(data.content);
            el.scrollTop = el.scrollHeight;
        }
    } catch (e) { console.error(e); }
}
function formatLog(text) {
    return text.split("\n").map(line => {
        if (line.includes("[SUCCESS]")) return `<div class="log-success"><i class="bi bi-check-circle-fill"></i> ${escapeHtml(line)}</div>`;
        if (line.includes("[WARNING]")) return `<div class="log-warning"><i class="bi bi-exclamation-triangle-fill"></i> ${escapeHtml(line)}</div>`;
        if (line.includes("[ERROR]")) return `<div class="log-error"><i class="bi bi-x-circle-fill"></i> ${escapeHtml(line)}</div>`;
        if (line.includes("[INFO]")) return `<div class="log-info"><i class="bi bi-info-circle"></i> ${escapeHtml(line)}</div>`;
        return `<div class="log-info">${escapeHtml(line)}</div>`;
    }).join("");
}

// === Player ===

// Encode path for URL: encode each segment, keep slashes
function encodePathForUrl(path) {
    return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

async function loadPlayerFiles() {
    const dir = document.getElementById("playerDir").value.trim();
    if (!dir) { showNotification(t("scan.select_dir"), "warning"); return; }

    // Show shimmer placeholders
    document.getElementById("playerFileList").innerHTML =
        '<div class="shimmer shimmer-row"></div>'.repeat(5);

    try {
        const res = await fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dir: dir }),
        });
        const data = await res.json();
        if (!res.ok || data.error) { showNotification(data.error || t("notification.error_prefix").trim(), "error"); return; }

        const list = document.getElementById("playerFileList");
        // Store file list in data attribute for later use
        list.dataset.filesJson = JSON.stringify(data.files);

        list.innerHTML = data.files.map((f, idx) => `
            <div class="file-item" data-file-idx="${idx}" onclick="selectPlayerFile(${idx})">
                <i class="bi bi-film" style="color:var(--accent);"></i>
                <span class="name">${escapeHtml(f.relative || f.filename)}</span>
                <span class="size">${f.size}</span>
            </div>
        `).join("");

        if (!data.files.length) {
            list.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">${t("player.no_mkv")}</div>`;
        }
    } catch (e) { showNotification(t("scan.network_error") + e.message, "error"); }
}

function selectPlayerFile(idx) {
    const list = document.getElementById("playerFileList");
    const files = JSON.parse(list.dataset.filesJson || "[]");
    const file = files[idx];
    if (!file) return;
    loadVideo(file.path);
}

async function loadVideo(filepath) {
    currentVideoPath = filepath;

    // Stop any audio preview when switching videos
    stopPreviewAudio();

    // Highlight selected file
    document.querySelectorAll('.file-item').forEach(e => e.classList.remove('active'));
    const list = document.getElementById("playerFileList");
    const files = JSON.parse(list.dataset.filesJson || "[]");
    const idx = files.findIndex(f => f.path === filepath);
    if (idx >= 0) {
        const el = list.querySelector(`[data-file-idx="${idx}"]`);
        if (el) el.classList.add('active');
    }

    // Show player
    document.getElementById("emptyPlayer").style.display = "none";
    document.getElementById("playerWrap").style.display = "block";

    // Set video source - encode path segments but keep slashes
    const video = document.getElementById("playerVideo");
    const url = "/api/video/" + encodePathForUrl(filepath);
    video.src = url;

    // Init Plyr if not already
    if (!player) {
        try {
            player = new Plyr(video, {
                controls: ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings', 'fullscreen'],
                settings: ['captions', 'quality', 'audio'],
            });
        } catch (e) {
            console.warn("Plyr init failed, using native video:", e);
        }
    }

    // Load track info
    await loadTrackInfo(filepath);
}

async function loadTrackInfo(filepath) {
    try {
        const res = await fetch("/api/track-info", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: filepath }),
        });
        const data = await res.json();
        if (data.error) { showNotification(data.error, "error"); return; }
        displayTrackPanel(data.tracks, filepath);
    } catch (e) { console.error(e); }
}

let currentPreviewAudio = null;
let currentPreviewTrackId = null;

function displayTrackPanel(tracks, filepath) {
    const list = document.getElementById("trackList");

    // Filter to only audio and subtitle tracks (not video)
    const mediaTracks = tracks.filter(t => t.type === "audio" || t.type === "subtitles");

    if (!mediaTracks.length) {
        list.innerHTML = `<div style="color:var(--text-muted); font-size:0.85rem; padding:8px;">${t("player.no_tracks")}</div>`;
        return;
    }

    list.innerHTML = mediaTracks.map(t => {
        const isAudio = t.type === "audio";
        const typeClass = isAudio ? "audio" : "subs";
        const typeLabel = isAudio ? window.t("player.audio") : window.t("player.subs");
        const defaultBtn = t.default
            ? `<button class="btn-set-default is-default"><i class="bi bi-check-circle-fill"></i> ${window.t("player.is_default")}</button>`
            : `<button class="btn-set-default not-default" data-filepath="${escapeAttr(filepath)}" data-track-id="${t.id}" data-track-type="${t.type}" onclick="setDefaultTrackFromBtn(this)">${window.t("player.set_default")}</button>`;
        const previewBtn = isAudio
            ? `<button class="btn-set-default not-default" data-filepath="${escapeAttr(filepath)}" data-track-id="${t.id}" onclick="previewAudioTrack(this)" title="${window.t("player.listen")}"><i class="bi bi-headphones"></i> ${window.t("player.listen")}</button>`
            : '';
        const watchBtn = isAudio
            ? `<button class="btn-set-default not-default" data-filepath="${escapeAttr(filepath)}" data-track-id="${t.id}" onclick="remuxAndPlay(this)" title="${window.t("player.watch_aria")}"><i class="bi bi-play-circle"></i> ${window.t("player.watch")}</button>`
            : '';
        return `<div class="track-row" data-track-id="${t.id}">
            <span class="track-type ${typeClass}">${typeLabel}</span>
            <div class="track-info">
                <span class="track-name">${escapeHtml(t.track_name || t.language || window.t("player.no_name"))}</span>
                <span class="track-lang">${t.language || ''} ${t.codec ? '· ' + t.codec : ''}</span>
            </div>
            ${previewBtn}
            ${watchBtn}
            ${defaultBtn}
        </div>`;
    }).join("");

    // Bulk default section: radio buttons + apply button
    const audioTracks = mediaTracks.filter(t => t.type === "audio");
    const subTracks = mediaTracks.filter(t => t.type === "subtitles");
    let bulkHtml = '<div class="bulk-default-section">';

    if (audioTracks.length > 1) {
        bulkHtml += `<div class="bulk-group"><span class="bulk-label"><i class="bi bi-music-note-beamed"></i> ${window.t("player.bulk_audio")}</span>`;
        bulkHtml += audioTracks.map((t, i) => `
            <label class="bulk-radio">
                <input type="radio" name="bulkAudio" value="${t.id}" data-language="${escapeAttr(t.language || '')}" data-codec="${escapeAttr(t.codec || '')}" ${t.default ? 'checked' : ''}>
                ${escapeHtml(t.track_name || t.language || ('#' + t.id))}
            </label>
        `).join('');
        bulkHtml += '</div>';
    }

    if (subTracks.length > 1) {
        bulkHtml += `<div class="bulk-group"><span class="bulk-label"><i class="bi bi-card-text"></i> ${window.t("player.bulk_subs")}</span>`;
        bulkHtml += subTracks.map((t, i) => `
            <label class="bulk-radio">
                <input type="radio" name="bulkSubs" value="${t.id}" data-language="${escapeAttr(t.language || '')}" data-codec="${escapeAttr(t.codec || '')}" ${t.default ? 'checked' : ''}>
                ${escapeHtml(t.track_name || t.language || ('#' + t.id))}
            </label>
        `).join('');
        bulkHtml += '</div>';
    }

    // Always show "no subtitles" option if there are any subtitle tracks
    if (subTracks.length > 0) {
        bulkHtml += `<div class="bulk-group"><label class="bulk-radio"><input type="checkbox" id="bulkNoSubs"> <i class="bi bi-eye-slash"></i> ${window.t("player.bulk_no_subs")}</label></div>`;
    }

    const hasBulkOptions = audioTracks.length > 1 || subTracks.length > 1 || subTracks.length > 0;
    if (hasBulkOptions) {
        bulkHtml += `<button class="btn-bulk-apply" onclick="applyBulkDefault(this)" data-filepath="${escapeAttr(filepath)}"><i class="bi bi-layers"></i> ${window.t("player.bulk_apply")}</button>`;
    }
    bulkHtml += '</div>';
    list.innerHTML += bulkHtml;

    // Add audio player container if not exists
    if (!document.getElementById("previewAudioPlayer")) {
        const playerDiv = document.createElement("div");
        playerDiv.id = "previewAudioPlayer";
        playerDiv.style.cssText = "display:none; margin-top:12px; padding:12px; background:rgba(0,0,0,0.25); border-radius:8px;";
        playerDiv.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
                <i class="bi bi-headphones" style="color:var(--accent);"></i>
                <span id="previewAudioLabel" style="font-size:0.85rem; color:var(--text-secondary);">${t("player.listening")}</span>
                <button onclick="stopPreviewAudio()" style="margin-left:auto; background:transparent; border:1px solid var(--border); color:var(--text-muted); border-radius:6px; padding:4px 10px; font-size:0.75rem; cursor:pointer;">${t("player.stop_preview")}</button>
            </div>
            <audio id="previewAudioEl" controls style="width:100%; height:40px;"></audio>
        `;
        document.getElementById("trackPanel").appendChild(playerDiv);
    }
}

async function previewAudioTrack(btn) {
    const filepath = btn.dataset.filepath;
    const trackId = parseInt(btn.dataset.trackId, 10);

    // Stop any current preview
    stopPreviewAudio();

    // Visual feedback on button
    btn.disabled = true;
    btn.innerHTML = `<span style="display:inline-block; width:12px; height:12px; border:2px solid rgba(255,255,255,0.3); border-top-color:var(--accent); border-radius:50%; animation:spin 0.6s linear infinite;"></span> ${t("notification.extracting")}`;

    try {
        const res = await fetch("/api/extract-audio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: filepath, track_id: trackId }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
            showNotification(data.error || t("notification.extract_error"), "error");
            btn.disabled = false;
            btn.innerHTML = `<i class="bi bi-headphones"></i> ${t("player.listen")}`;
            return;
        }

        // Show audio player and play
        const playerDiv = document.getElementById("previewAudioPlayer");
        const audioEl = document.getElementById("previewAudioEl");
        const label = document.getElementById("previewAudioLabel");

        playerDiv.style.display = "block";
        audioEl.src = data.audio_url;
        audioEl.play();
        label.textContent = t("notification.track_label", { id: trackId });

        currentPreviewAudio = audioEl;
        currentPreviewTrackId = trackId;

        // Highlight the active track row
        document.querySelectorAll('.track-row').forEach(r => r.style.background = '');
        const row = btn.closest('.track-row');
        if (row) row.style.background = 'rgba(234,88,12,0.1)';

        // Reset button
        btn.disabled = false;
        btn.innerHTML = `<i class="bi bi-stop-fill"></i> ${t("notification.playing")}`;
        btn.onclick = () => { stopPreviewAudio(); };

    } catch (e) {
        showNotification(t("notification.error_prefix") + e.message, "error");
        btn.disabled = false;
        btn.innerHTML = `<i class="bi bi-headphones"></i> ${t("player.listen")}`;
    }
}

function stopPreviewAudio() {
    const audioEl = document.getElementById("previewAudioEl");
    if (audioEl) {
        audioEl.pause();
        audioEl.src = "";
    }
    const playerDiv = document.getElementById("previewAudioPlayer");
    if (playerDiv) playerDiv.style.display = "none";

    // Reset all preview buttons
    document.querySelectorAll('.track-row').forEach(r => {
        r.style.background = '';
        const previewBtn = r.querySelector('button[onclick*="previewAudioTrack"], button[onclick*="stopPreviewAudio"]');
        if (previewBtn) {
            previewBtn.disabled = false;
            previewBtn.innerHTML = `<i class="bi bi-headphones"></i> ${t("player.listen")}`;
            previewBtn.onclick = function() { previewAudioTrack(this); };
        }
    });

    currentPreviewAudio = null;
    currentPreviewTrackId = null;
}

async function remuxAndPlay(btn) {
    const filepath = btn.dataset.filepath;
    const trackId = parseInt(btn.dataset.trackId, 10);

    // Stop any current preview
    stopPreviewAudio();

    btn.disabled = true;
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<span style="display:inline-block; width:12px; height:12px; border:2px solid rgba(255,255,255,0.3); border-top-color:var(--accent); border-radius:50%; animation:spin 0.6s linear infinite;"></span> ${t("player.remuxing")}`;

    try {
        showNotification(t("player.preparing"), "info");
        const res = await fetch("/api/remux-video", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: filepath, audio_track_id: trackId }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
            showNotification(data.error || t("player.remux_error"), "error");
            btn.disabled = false;
            btn.innerHTML = origHtml;
            return;
        }

        // Load remuxed video into player
        const video = document.getElementById("playerVideo");
        video.src = data.video_url;
        video.load();
        video.play();
        showNotification(t("player.video_ready"), "success");

        // Highlight active track
        document.querySelectorAll('.track-row').forEach(r => r.style.background = '');
        const row = btn.closest('.track-row');
        if (row) row.style.background = 'rgba(234,88,12,0.1)';

    } catch (e) {
        showNotification(t("notification.error_prefix") + e.message, "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = origHtml;
    }
}

async function applyBulkDefault(btn) {
    const filepath = btn.dataset.filepath;
    const dir = filepath.substring(0, filepath.lastIndexOf("/")) || "/";

    const audioRadio = document.querySelector('input[name="bulkAudio"]:checked');
    const subsRadio = document.querySelector('input[name="bulkSubs"]:checked');
    const noSubsCheck = document.getElementById('bulkNoSubs');

    if (!audioRadio && !subsRadio && !(noSubsCheck && noSubsCheck.checked)) {
        showNotification(t("player.select_track"), "warning");
        return;
    }

    btn.disabled = true;
    btn.innerHTML = `<span style="display:inline-block; width:12px; height:12px; border:2px solid rgba(255,255,255,0.3); border-top-color:var(--accent); border-radius:50%; animation:spin 0.6s linear infinite;"></span> ${t("player.applying")}`;

    let totalProcessed = 0, totalSkipped = 0, totalErrors = 0;

    try {
        if (audioRadio) {
            const body = { dir: dir, type: "audio", language: audioRadio.dataset.language, codec: audioRadio.dataset.codec };
            const res = await fetch("/api/set-default-track-bulk", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                showNotification(t("player.audio") + ": " + (data.error || t("notification.error_prefix").trim()), "error");
            } else {
                totalProcessed += data.processed;
                totalSkipped += data.skipped;
                totalErrors += data.errors;
            }
        }

        if (subsRadio) {
            const body = { dir: dir, type: "subtitles", language: subsRadio.dataset.language, codec: subsRadio.dataset.codec };
            const res = await fetch("/api/set-default-track-bulk", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                showNotification(t("player.subs") + ": " + (data.error || t("notification.error_prefix").trim()), "error");
            } else {
                totalProcessed += data.processed;
                totalSkipped += data.skipped;
                totalErrors += data.errors;
            }
        }

        if (noSubsCheck && noSubsCheck.checked) {
            const res = await fetch("/api/disable-subs-bulk", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dir: dir }),
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                showNotification(t("player.subs") + ": " + (data.error || t("notification.error_prefix").trim()), "error");
            } else {
                totalProcessed += data.processed;
                totalSkipped += data.skipped;
                totalErrors += data.errors;
            }
        }

        const parts = [t("notification.done", { count: totalProcessed })];
        if (totalSkipped > 0) parts.push(t("notification.skipped", { count: totalSkipped }));
        if (totalErrors > 0) parts.push(t("notification.errors_count", { count: totalErrors }));
        showNotification(parts.join(", "), totalErrors > 0 ? "warning" : "success");

        if (currentVideoPath) await loadTrackInfo(currentVideoPath);
    } catch (e) {
        showNotification(t("notification.error_prefix") + e.message, "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="bi bi-layers"></i> ${t("player.bulk_apply")}`;
    }
}

async function setDefaultTrackFromBtn(btn) {
    const filepath = btn.dataset.filepath;
    const trackId = parseInt(btn.dataset.trackId, 10);
    const trackType = btn.dataset.trackType;
    await setDefaultTrack(filepath, trackId, trackType);
}

async function setDefaultTrack(filepath, trackId, trackType) {
    try {
        const res = await fetch("/api/set-default-track", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: filepath, track_id: trackId, type: trackType }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
            showNotification(data.error || t("notification.error_prefix").trim(), "error");
            return;
        }
        showNotification(t("notification.default_changed"), "success");
        // Reload track info
        await loadTrackInfo(filepath);
    } catch (e) { showNotification(t("notification.error_prefix") + e.message, "error"); }
}

async function setDefaultTrackBulk(btn) {
    const filepath = btn.dataset.filepath;
    const trackName = btn.dataset.trackName;
    const trackLanguage = btn.dataset.trackLanguage;
    const trackCodec = btn.dataset.trackCodec;
    const trackType = btn.dataset.trackType;
    // Extract directory from filepath
    const dir = filepath.substring(0, filepath.lastIndexOf("/")) || "/";

    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-block; width:12px; height:12px; border:2px solid rgba(255,255,255,0.3); border-top-color:#A78BFA; border-radius:50%; animation:spin 0.6s linear infinite;"></span>';

    try {
        const body = { dir: dir, type: trackType };
        if (trackName) body.track_name = trackName;
        if (trackLanguage) body.language = trackLanguage;
        if (trackCodec) body.codec = trackCodec;

        const res = await fetch("/api/set-default-track-bulk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
            showNotification(data.error || t("notification.error_prefix").trim(), "error");
            btn.disabled = false;
            btn.innerHTML = `<i class="bi bi-layers"></i> ${t("player.bulk_apply")}`;
            return;
        }
        const parts = [t("notification.changed", { count: data.processed })];
        if (data.skipped > 0) parts.push(t("notification.skipped", { count: data.skipped }));
        if (data.errors > 0) parts.push(t("notification.errors_count", { count: data.errors }));
        showNotification(parts.join(", "), data.errors > 0 ? "warning" : "success");
        // Reload current file track info
        if (currentVideoPath) await loadTrackInfo(currentVideoPath);
    } catch (e) {
        showNotification(t("notification.error_prefix") + e.message, "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="bi bi-layers"></i> ${t("player.bulk_apply")}`;
    }
}

// === Init ===

document.addEventListener("DOMContentLoaded", () => {
    // Collapse toggles
    document.querySelectorAll('[data-bs-toggle="collapse"]').forEach(header => {
        header.addEventListener('click', () => {
            const target = document.querySelector(header.dataset.bsTarget);
            if (target) { target.classList.toggle('show'); header.classList.toggle('collapsed'); }
        });
    });

    loadLogSessions();

    // Auto-load player files when player section is opened
    const playerSection = document.getElementById("playerSection");
    if (playerSection) {
        const observer = new MutationObserver(() => {
            if (playerSection.classList.contains("show")) {
                const dir = document.getElementById("playerDir").value.trim();
                if (dir) loadPlayerFiles();
            }
        });
        observer.observe(playerSection, { attributes: true, attributeFilter: ["class"] });
    }
});

// === Utilities ===

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
}
function escapeHtml(str) { const div = document.createElement("div"); div.textContent = str; return div.innerHTML; }
function escapeAttr(str) { return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function showNotification(message, type = "info") {
    document.querySelectorAll(".toast-notification").forEach(n => n.remove());
    const toast = document.createElement("div");
    toast.className = "toast-notification";
    toast.style.cssText = `position:fixed;top:24px;right:24px;z-index:2000;padding:14px 20px;border-radius:12px;font-size:0.9rem;font-weight:500;max-width:400px;display:flex;align-items:center;gap:10px;backdrop-filter:blur(15px);-webkit-backdrop-filter:blur(15px);border:1px solid rgba(255,255,255,0.1);transform:translateX(120%);transition:transform 0.4s cubic-bezier(0.16,1,0.3,1);`;
    const colors = {
        success: { bg: "rgba(34,197,94,0.15)", color: "#22C55E", icon: "bi-check-circle-fill" },
        warning: { bg: "rgba(245,158,11,0.15)", color: "#F59E0B", icon: "bi-exclamation-triangle-fill" },
        error: { bg: "rgba(239,68,68,0.15)", color: "#EF4444", icon: "bi-x-circle-fill" },
        info: { bg: "rgba(59,130,246,0.15)", color: "#3B82F6", icon: "bi-info-circle-fill" },
    };
    const c = colors[type] || colors.info;
    toast.style.background = c.bg; toast.style.color = c.color;
    toast.innerHTML = `<i class="bi ${c.icon}"></i> ${escapeHtml(message)}`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.transform = "translateX(0)"; });
    setTimeout(() => { toast.style.transform = "translateX(120%)"; setTimeout(() => toast.remove(), 400); }, 3500);
}
