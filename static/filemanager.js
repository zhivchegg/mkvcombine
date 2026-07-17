// File Manager for MKVCombine

let fmTarget = null;
let fmCurrentPath = "/";
let fmSelectedPath = null;

function openFileManager(targetId) {
    fmTarget = targetId;
    fmSelectedPath = null;

    const startDirs = {
        serialDir: "/video",
        outputDir: "/video",
        playerDir: "/video",
    };
    fmCurrentPath = startDirs[targetId] || "/";

    document.getElementById("fileManagerModal").classList.add("open");
    fmLoad(fmCurrentPath);
}

function closeFileManager() {
    document.getElementById("fileManagerModal").classList.remove("open");
}

document.addEventListener("click", (e) => {
    if (e.target.id === "fileManagerModal") closeFileManager();
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeFileManager();
});

async function fmLoad(path) {
    fmSelectedPath = path;
    document.getElementById("fmSelectBtn").disabled = false;

    const el = document.getElementById("fmContents");
    el.innerHTML = `<div style="text-align:center; padding:40px;"><div style="display:inline-block; width:24px; height:24px; border:2px solid rgba(255,255,255,0.2); border-top-color:var(--accent); border-radius:50%; animation:spin 0.6s linear infinite;"></div> <span style="margin-left:8px; color:var(--text-muted);">${t("fm.loading")}</span></div>`;

    if (!document.getElementById("fm-spinner-style")) {
        const style = document.createElement("style");
        style.id = "fm-spinner-style";
        style.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
        document.head.appendChild(style);
    }

    try {
        const res = await fetch("/api/browse", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ base: path, path: "" }),
        });
        const data = await res.json();

        if (data.error) {
            el.innerHTML = `<div style="padding:24px; color:var(--danger); text-align:center;"><i class="bi bi-exclamation-circle"></i> ${escapeHtml(data.error)}</div>`;
            return;
        }

        fmCurrentPath = data.current;
        document.getElementById("fmCurrentPath").textContent = data.current;

        let html = "";

        if (data.parent) {
            html += `<div class="fm-item" onclick="fmLoad('${escapeAttr(data.parent)}')">
                <span class="icon" style="color:var(--text-muted);"><i class="bi bi-arrow-up-circle"></i></span>
                <span class="name" style="color:var(--text-muted); font-style:italic;">..</span>
            </div>`;
        }

        for (const item of data.items) {
            const iconColor = item.is_dir ? "color:var(--warning);" : "color:var(--accent);";
            const icon = item.is_dir ? "bi-folder-fill" : "bi-file-earmark";
            const size = item.is_dir ? "" : `<span class="size">${item.size_fmt}</span>`;
            const click = item.is_dir ? `onclick="fmLoad('${escapeAttr(item.path)}')"` : "";

            html += `<div class="fm-item" ${click}>
                <span class="icon" style="${iconColor}"><i class="bi ${icon}"></i></span>
                <span class="name">${escapeHtml(item.name)}</span>
                ${size}
            </div>`;
        }

        if (!data.items.length && !data.parent) {
            html = `<div style="text-align:center; padding:40px; color:var(--text-muted);"><i class="bi bi-folder2" style="font-size:24px; display:block; margin-bottom:8px;"></i>${t("fm.empty")}</div>`;
        }

        el.innerHTML = html;
    } catch (e) {
        el.innerHTML = `<div style="padding:24px; color:var(--danger); text-align:center;"><i class="bi bi-wifi-off"></i> ${t("fm.load_error")}${escapeHtml(e.message)}</div>`;
    }
}

function fmGoUp() {
    const parts = fmCurrentPath.split("/").filter(Boolean);
    if (parts.length > 0) {
        parts.pop();
        fmLoad("/" + parts.join("/") || "/");
    }
}

function fmSelect() {
    if (!fmSelectedPath || !fmTarget) return;
    const input = document.getElementById(fmTarget);
    input.value = fmCurrentPath;
    input.style.borderColor = "var(--success)";
    input.style.boxShadow = "0 0 0 3px rgba(34,197,94,0.2)";
    setTimeout(() => { input.style.borderColor = ""; input.style.boxShadow = ""; }, 800);
    closeFileManager();
}

async function fmCreateFolder() {
    const name = prompt(t("fm.folder_name"), "");
    if (!name || !name.trim()) return;

    // Sanitize
    const clean = name.trim().replace(/[/\\]/g, "");
    if (!clean) return;

    const newPath = fmCurrentPath + "/" + clean;

    try {
        const res = await fetch("/api/mkdir", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: newPath }),
        });
        const data = await res.json();

        if (!res.ok || data.error) {
            alert(t("notification.error_prefix") + (data.error || t("fm.create_error")));
            return;
        }

        // Reload current directory to show the new folder
        fmLoad(fmCurrentPath);
    } catch (e) {
        alert(t("fm.network_error") + e.message);
    }
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function escapeAttr(str) {
    return str.replace(/'/g, "\\'").replace(/"/g, "&quot;");
}
