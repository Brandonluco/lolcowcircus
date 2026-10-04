// =====================================================================
// CowTube Slots — admin panel (Stage 2b)
//
// Self-contained: everything lives inside this one function so none of
// its names can collide with admin.js. It talks only to /api/slots/admin/*
// (which requires your Cloudflare Access login) and never touches the
// rest of the admin page.
//
// The image tool runs entirely in your browser: it trims empty space,
// fits the picture onto a 256x256 transparent square, compresses it, and
// shows a preview BEFORE anything is uploaded. The server then re-checks
// the result, so a bad file can never reach the reels.
// =====================================================================

(function () {

    "use strict";

    const root = document.getElementById("slotsAdmin");

    if (!root) {
        return;
    }

    const API = "/api/slots/admin";

    // Must match the server (slots-admin.js).
    const SIZE = 256;
    const MARGIN = Math.round(SIZE * 0.08);   // ~8% breathing room
    const ALPHA_CUTOFF = 24;                  // below this = leftover haze, made fully clear
    const MAX_RAW_BYTES = 5 * 1024 * 1024;    // biggest file we'll even try to open
    const MAX_SOURCE_PIXELS = 2048;           // very large images are shrunk first

    const els = {
        message: document.getElementById("slotsMessage"),
        status: document.getElementById("slotsStatus"),
        tool: document.getElementById("slotsTool"),
        faces: document.getElementById("slotsFaces"),
        prizes: document.getElementById("slotsPrizes"),
        settings: document.getElementById("slotsSettings"),
        activity: document.getElementById("slotsActivity")
    };

    const state = {
        overview: null,
        faceFilter: "all",
        tool: null           // the image currently being prepared, if any
    };

    // -----------------------------------------------------------------
    // Small helpers
    // -----------------------------------------------------------------

    function esc(value) {
        const div = document.createElement("div");
        div.textContent = value === null || value === undefined ? "" : String(value);
        return div.innerHTML;
    }

    // Image URLs come back from our own server, but they're checked anyway
    // before being put into a src attribute.
    function safeImageUrl(url) {
        return typeof url === "string" && url.startsWith("/api/images/") ? url : "";
    }

    function formatPoints(value) {
        const rounded = Math.round(Number(value) * 100) / 100;
        return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}`;
    }

    function showMessage(text, kind) {
        els.message.textContent = text;
        els.message.className = `slots-message slots-message-${kind || "info"}`;
        if (kind !== "error") {
            clearTimeout(showMessage.timer);
            showMessage.timer = setTimeout(() => els.message.classList.add("hidden"), 6000);
        }
    }

    function hideMessage() {
        els.message.classList.add("hidden");
    }

    async function api(path, options) {

        let response;

        try {
            response = await fetch(`${API}${path}`, options);
        } catch (err) {
            return { ok: false, status: 0, body: { message: "Couldn't reach the server." } };
        }

        let body = null;

        try {
            body = await response.json();
        } catch {
            body = {};
        }

        if (response.status === 401 || response.status === 403) {
            body = { message: "Your admin session expired — refresh this page and try again." };
        }

        return { ok: response.ok, status: response.status, body: body };

    }

    function postJson(path, data, method) {
        return api(path, {
            method: method || "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
    }

    // -----------------------------------------------------------------
    // Pure helpers (also exposed at the bottom so they can be tested)
    // -----------------------------------------------------------------

    // Smallest box containing every pixel that isn't (nearly) transparent.
    function alphaBounds(data, width, height, cutoff) {

        let minX = width, minY = height, maxX = -1, maxY = -1;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (data[(y * width + x) * 4 + 3] >= cutoff) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }

        if (maxX < 0) {
            return null;
        }

        return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };

    }

    // Where the trimmed picture goes on the 256x256 square.
    //   bust   -> head-and-shoulders: bottom edge sits flush on the bottom of
    //             the tile (the cut-off shoulders look intentional), margin
    //             on the top and sides only.
    //   object -> full silhouette: centered with margin all the way around.
    function layoutFor(mode, w, h) {

        if (mode === "bust") {
            const scale = Math.min((SIZE - 2 * MARGIN) / w, (SIZE - MARGIN) / h);
            const dw = Math.max(1, Math.round(w * scale));
            const dh = Math.max(1, Math.round(h * scale));
            return { x: Math.round((SIZE - dw) / 2), y: SIZE - dh, w: dw, h: dh };
        }

        const scale = Math.min((SIZE - 2 * MARGIN) / w, (SIZE - 2 * MARGIN) / h);
        const dw = Math.max(1, Math.round(w * scale));
        const dh = Math.max(1, Math.round(h * scale));
        return { x: Math.round((SIZE - dw) / 2), y: Math.round((SIZE - dh) / 2), w: dw, h: dh };

    }

    // Fewer distinct colors compresses much better as a PNG. Used only as a
    // fallback for browsers that can't save WebP.
    function posterize(imageData, levels) {

        const out = new Uint8ClampedArray(imageData.data);
        const step = 255 / (levels - 1);

        for (let i = 0; i < out.length; i += 4) {
            if (out[i + 3] === 0) {
                continue;
            }
            out[i] = Math.round(Math.round(out[i] / step) * step);
            out[i + 1] = Math.round(Math.round(out[i + 1] / step) * step);
            out[i + 2] = Math.round(Math.round(out[i + 2] / step) * step);
        }

        return out;

    }

    // Same math as the server's oddsSummary(), so the live readout matches
    // what the server will compute when you save.
    function oddsSummary(jackpotPoints, jackpotOdds, prizes) {

        let combined = 1 / jackpotOdds;
        let net = (jackpotPoints / jackpotOdds) * 100;
        let gross = (Math.abs(jackpotPoints) / jackpotOdds) * 100;

        for (const prize of prizes) {
            if (!prize.enabled) continue;
            combined += 1 / prize.odds;
            net += (prize.points / prize.odds) * 100;
            gross += (Math.abs(prize.points) / prize.odds) * 100;
        }

        return {
            combinedWinRate: combined,
            oneInEverySpins: Math.round(1 / combined),
            net: Math.round(net * 1000) / 1000,
            gross: Math.round(gross * 1000) / 1000
        };

    }

    // -----------------------------------------------------------------
    // The image tool: open -> trim -> fit -> compress -> preview -> upload
    // -----------------------------------------------------------------

    async function openBitmap(file) {

        try {
            return await createImageBitmap(file);
        } catch (err) {
            // Older Safari: fall back to a regular <img>.
            return await new Promise((resolve, reject) => {
                const url = URL.createObjectURL(file);
                const img = new Image();
                // If the browser never says "loaded" or "failed", don't hang forever.
                const timer = setTimeout(() => { URL.revokeObjectURL(url); reject(new Error("decode timed out")); }, 10000);
                img.onload = () => { clearTimeout(timer); URL.revokeObjectURL(url); resolve(img); };
                img.onerror = () => { clearTimeout(timer); URL.revokeObjectURL(url); reject(new Error("decode failed")); };
                img.src = url;
            });
        }

    }

    async function loadSource(file) {

        let bitmap;

        try {
            bitmap = await openBitmap(file);
        } catch (err) {
            throw new Error("Couldn't open that file as an image.");
        }

        let width = bitmap.width;
        let height = bitmap.height;
        const biggest = Math.max(width, height);

        if (biggest > MAX_SOURCE_PIXELS) {
            const shrink = MAX_SOURCE_PIXELS / biggest;
            width = Math.max(1, Math.round(width * shrink));
            height = Math.max(1, Math.round(height * shrink));
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0, width, height);

        const image = ctx.getImageData(0, 0, width, height);
        const data = image.data;

        let hasAlpha = false;

        for (let i = 3; i < data.length; i += 4) {
            if (data[i] < 255) {
                hasAlpha = true;
                break;
            }
        }

        // Cutout: wipe faint leftover haze from background removal so it
        // can't show up as a gray smudge on the dark cabinet.
        if (hasAlpha) {
            for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3] < ALPHA_CUTOFF) {
                    data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
                }
            }
            ctx.putImageData(image, 0, 0);
        }

        return { canvas: canvas, width: width, height: height, hasAlpha: hasAlpha, data: data };

    }

    function compose(source, mode) {

        const out = document.createElement("canvas");
        out.width = SIZE;
        out.height = SIZE;

        const ctx = out.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        // A picture with no transparency at all (like the gray tiles) is
        // just cropped to a centered square — nothing to trim or pad.
        if (!source.hasAlpha) {
            const side = Math.min(source.width, source.height);
            ctx.drawImage(
                source.canvas,
                Math.floor((source.width - side) / 2), Math.floor((source.height - side) / 2), side, side,
                0, 0, SIZE, SIZE
            );
            return out;
        }

        const box = alphaBounds(source.data, source.width, source.height, ALPHA_CUTOFF);

        if (!box) {
            throw new Error("That image looks completely empty/transparent.");
        }

        const place = layoutFor(mode, box.w, box.h);

        ctx.drawImage(source.canvas, box.x, box.y, box.w, box.h, place.x, place.y, place.w, place.h);

        return out;

    }

    function toBlob(canvas, type, quality) {
        return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
    }

    // Tries WebP first (smallest), stepping the quality down until it fits.
    // Browsers that can't save WebP quietly hand back a PNG instead, in
    // which case we squeeze it by reducing colors.
    async function exportUnderLimit(canvas, limitBytes) {

        let blob = await toBlob(canvas, "image/webp", 0.92);

        if (blob && blob.type === "image/webp") {

            for (const quality of [0.92, 0.85, 0.75, 0.65, 0.55, 0.45]) {
                blob = await toBlob(canvas, "image/webp", quality);
                if (blob.size <= limitBytes) {
                    return { blob: blob, format: "WebP", note: `quality ${Math.round(quality * 100)}`, fits: true };
                }
            }

            return { blob: blob, format: "WebP", note: "", fits: false };

        }

        blob = await toBlob(canvas, "image/png");

        if (blob.size <= limitBytes) {
            return { blob: blob, format: "PNG", note: "your browser can't save WebP", fits: true };
        }

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const original = ctx.getImageData(0, 0, canvas.width, canvas.height);

        for (const levels of [64, 48, 32, 24, 16]) {

            const copy = document.createElement("canvas");
            copy.width = canvas.width;
            copy.height = canvas.height;

            const copyCtx = copy.getContext("2d");
            const reduced = new ImageData(posterize(original, levels), canvas.width, canvas.height);
            copyCtx.putImageData(reduced, 0, 0);

            blob = await toBlob(copy, "image/png");

            if (blob.size <= limitBytes) {
                return { blob: blob, format: "PNG", note: `colors reduced to fit (your browser can't save WebP)`, fits: true };
            }

        }

        return { blob: blob, format: "PNG", note: "", fits: false };

    }

    function maxBytes() {
        const kb = state.overview?.limits?.maxImageKb || 150;
        return kb * 1024;
    }

    function revokeToolPreview() {
        if (state.tool && state.tool.previewUrl) {
            URL.revokeObjectURL(state.tool.previewUrl);
            state.tool.previewUrl = null;
        }
    }

    function closeTool() {
        revokeToolPreview();
        state.tool = null;
        els.tool.classList.add("hidden");
        els.tool.innerHTML = "";
    }

    function pickFile(kind, id, name) {

        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/png,image/webp,image/jpeg";

        input.addEventListener("change", () => {
            const file = input.files && input.files[0];
            if (file) {
                startTool(kind, id, name, file);
            }
        });

        input.click();

    }

    async function startTool(kind, id, name, file) {

        revokeToolPreview();

        if (!file.type.startsWith("image/")) {
            showMessage("That doesn't look like an image file.", "error");
            return;
        }

        if (file.size > MAX_RAW_BYTES) {
            showMessage(`That file is ${(file.size / 1048576).toFixed(1)}MB — please use one under 5MB.`, "error");
            return;
        }

        hideMessage();

        state.tool = {
            kind: kind,
            id: id,
            name: name,
            // Streamers are head-and-shoulders; prizes are whole objects.
            mode: kind === "face" ? "bust" : "object",
            source: null,
            result: null,
            previewUrl: null,
            error: null,
            busy: true
        };

        renderTool();
        els.tool.scrollIntoView({ behavior: "smooth", block: "nearest" });

        try {
            state.tool.source = await loadSource(file);
        } catch (err) {
            state.tool.error = err.message;
            state.tool.busy = false;
            renderTool();
            return;
        }

        await reprocessTool();

    }

    async function reprocessTool() {

        const tool = state.tool;

        if (!tool || !tool.source) {
            return;
        }

        revokeToolPreview();
        tool.busy = true;
        tool.error = null;
        tool.result = null;
        renderTool();

        try {

            const canvas = compose(tool.source, tool.mode);
            const result = await exportUnderLimit(canvas, maxBytes());

            if (state.tool !== tool) {
                return;
            }

            tool.result = result;
            tool.previewUrl = URL.createObjectURL(result.blob);

            if (!result.fits) {
                tool.error = `Even compressed, this is ${Math.round(result.blob.size / 1024)}KB (limit ${Math.round(maxBytes() / 1024)}KB). Try a simpler image.`;
            }

        } catch (err) {
            tool.error = err.message || "Couldn't process that image.";
        }

        tool.busy = false;
        renderTool();

    }

    function renderTool() {

        const tool = state.tool;

        if (!tool) {
            closeTool();
            return;
        }

        els.tool.classList.remove("hidden");

        const isTile = tool.source && !tool.source.hasAlpha;
        const limitKb = Math.round(maxBytes() / 1024);

        let body = "";

        if (tool.busy) {
            body = `<p class="admin-note">Processing…</p>`;
        } else {

            const preview = tool.previewUrl
                ? `
                    <div class="slots-preview-row">
                        <div class="slots-preview-reel slots-preview-big"><img src="${esc(tool.previewUrl)}" alt="Preview"></div>
                        <div class="slots-preview-reel slots-preview-small"><img src="${esc(tool.previewUrl)}" alt="Preview small"></div>
                        <div class="slots-preview-checker"><img src="${esc(tool.previewUrl)}" alt="Preview on checkerboard"></div>
                    </div>
                  `
                : "";

            const info = tool.result
                ? `<p class="admin-note">${esc(tool.result.format)}, ${SIZE}×${SIZE}, ${Math.round(tool.result.blob.size / 1024)}KB of ${limitKb}KB allowed${tool.result.note ? " — " + esc(tool.result.note) : ""}.</p>`
                : "";

            const modeControls = isTile
                ? `<p class="admin-note">This image has no transparent background, so it's just cropped to a centered square (no trimming or padding).</p>`
                : `
                    <div class="slots-mode">
                        <label><input type="radio" name="slotsToolMode" value="bust" ${tool.mode === "bust" ? "checked" : ""}> Bust — head &amp; shoulders sit on the bottom edge</label>
                        <label><input type="radio" name="slotsToolMode" value="object" ${tool.mode === "object" ? "checked" : ""}> Object — centered with space all around</label>
                    </div>
                  `;

            body = `
                ${modeControls}
                ${preview}
                ${info}
                ${tool.error ? `<p class="slots-error">${esc(tool.error)}</p>` : ""}
            `;

        }

        const canUpload = !tool.busy && tool.result && tool.result.fits && !tool.error;

        els.tool.innerHTML = `
            <h3>Preparing image for: ${esc(tool.name)}</h3>
            ${body}
            <div class="slots-tool-buttons">
                <button type="button" data-action="tool-upload" ${canUpload ? "" : "disabled"}>⬆ Upload this image</button>
                <button type="button" data-action="tool-cancel">Cancel</button>
            </div>
        `;

    }

    async function uploadTool() {

        const tool = state.tool;

        if (!tool || !tool.result || !tool.result.fits) {
            return;
        }

        tool.busy = true;
        renderTool();

        const path = tool.kind === "face"
            ? `/face-image?streamer_id=${encodeURIComponent(tool.id)}`
            : `/prize-image?prize_id=${encodeURIComponent(tool.id)}`;

        const res = await api(path, {
            method: "POST",
            headers: { "Content-Type": tool.result.blob.type },
            body: tool.result.blob
        });

        if (!res.ok) {
            tool.busy = false;
            tool.error = res.body.message || "Upload failed.";
            renderTool();
            return;
        }

        const savedName = tool.name;
        closeTool();
        showMessage(`Image saved for ${savedName}.`, "success");
        await refresh();

    }

    // -----------------------------------------------------------------
    // Rendering: status, faces, prizes, settings, activity
    // -----------------------------------------------------------------

    function liveOdds() {

        // Reads whatever is currently typed in the form (even if unsaved),
        // falling back to the saved values.
        const ov = state.overview;
        const settingsInput = els.settings.querySelector('[data-setting="jackpot_odds"]');
        const pointsInput = els.settings.querySelector('[data-setting="jackpot_points"]');

        const jackpotOdds = Number(settingsInput ? settingsInput.value : ov.settings.jackpot_odds);
        const jackpotPoints = Number(pointsInput ? pointsInput.value : ov.settings.jackpot_points);

        const rows = els.prizes.querySelectorAll("[data-prize-row]");
        const prizes = [];

        rows.forEach((row) => {
            prizes.push({
                enabled: row.querySelector('[data-field="enabled"]').checked,
                odds: Number(row.querySelector('[data-field="odds"]').value),
                points: Number(row.querySelector('[data-field="points"]').value)
            });
        });

        const valid = Number.isFinite(jackpotOdds) && jackpotOdds >= 2 && Number.isFinite(jackpotPoints)
            && prizes.every((p) => !p.enabled || (Number.isFinite(p.odds) && p.odds >= 2 && Number.isFinite(p.points)));

        if (!valid) {
            return null;
        }

        return oddsSummary(jackpotPoints, jackpotOdds, prizes);

    }

    function renderStatus() {

        const ov = state.overview;
        const s = ov.summary;
        const min = ov.settings.min_streamers;

        const machine = s.machineLive
            ? `<span class="slots-pill slots-pill-live">● Machine is LIVE</span> ${s.streamersOnReels} streamers on the reels`
            : `<span class="slots-pill slots-pill-off">● Machine is hidden</span> ${s.streamersOnReels} of ${min} streamers needed — add ${Math.max(0, min - s.streamersOnReels)} more with images`;

        const limit = ov.settings.global_daily_spin_limit;

        els.status.innerHTML = `
            <div class="slots-status-line">${machine}</div>
            <div class="slots-status-line" id="slotsOddsLine"></div>
            <div class="slots-status-line">
                Today (UTC day): <strong>${esc(ov.today.spins)}</strong> spins by <strong>${esc(ov.today.players)}</strong> visitors,
                <strong>${esc(ov.today.wins)}</strong> wins · site-wide limit ${esc(limit.toLocaleString())} spins/day
            </div>
        `;

        renderOddsLine();

    }

    function renderOddsLine() {

        const line = document.getElementById("slotsOddsLine");

        if (!line || !state.overview) {
            return;
        }

        const saved = state.overview.summary;
        const live = liveOdds();
        const maxRate = state.overview.limits.maxCombinedWinRate;

        if (!live) {
            line.innerHTML = `Odds: <em>fix the highlighted numbers to see the live readout</em>`;
            return;
        }

        const changed = Math.abs(live.combinedWinRate - saved.combinedWinRate) > 1e-9
            || Math.abs(live.net - saved.netPointsPer100Spins) > 1e-9;

        const tooHigh = live.combinedWinRate > maxRate;

        line.className = `slots-status-line ${tooHigh ? "slots-warn" : ""}`;

        line.innerHTML = `
            Odds${changed ? " <em>(with your unsaved changes)</em>" : ""}:
            about <strong>1 in ${esc(live.oneInEverySpins)}</strong> spins wins something ·
            average stock movement per 100 spins: <strong>${esc(formatPoints(live.net))}</strong> net
            (${esc(live.gross.toFixed(2))} total moved)
            ${tooHigh ? `<br><strong>Too generous — the server won't allow more than 1 in ${Math.round(1 / maxRate)}.</strong>` : ""}
        `;

    }

    function statusBadge(status) {

        const labels = {
            on_reels: ["On the reels", "slots-badge-on"],
            needs_image: ["Needs image", "slots-badge-needs"],
            opted_out: ["Opted out", "slots-badge-out"],
            off: ["Switched off", "slots-badge-off"]
        };

        const [label, cls] = labels[status] || labels.off;

        return `<span class="slots-badge ${cls}">${label}</span>`;

    }

    function renderFaces() {

        const list = state.overview.streamers;

        const counts = {
            all: list.length,
            on_reels: list.filter((s) => s.status === "on_reels").length,
            needs_image: list.filter((s) => s.status === "needs_image").length,
            opted_out: list.filter((s) => s.status === "opted_out").length
        };

        const filters = [
            ["all", `All (${counts.all})`],
            ["on_reels", `On reels (${counts.on_reels})`],
            ["needs_image", `Needs image (${counts.needs_image})`],
            ["opted_out", `Opted out (${counts.opted_out})`]
        ];

        const filterHtml = filters.map(([key, label]) => `
            <button type="button" class="slots-filter ${state.faceFilter === key ? "slots-filter-active" : ""}"
                data-action="face-filter" data-filter="${key}">${esc(label)}</button>
        `).join("");

        const visible = list.filter((s) => state.faceFilter === "all" || s.status === state.faceFilter);

        const rows = visible.map((s) => {

            const thumb = s.image
                ? `<img class="slots-thumb" src="${esc(safeImageUrl(s.image))}" alt="">`
                : `<div class="slots-thumb slots-thumb-empty">?</div>`;

            const cooldown = s.onCooldown
                ? `<div class="admin-note">Jackpot cooldown until ${esc(new Date(s.cooldownUntil).toLocaleString())}</div>`
                : "";

            return `
                <div class="slots-row" data-streamer-id="${esc(s.id)}">
                    ${thumb}
                    <div class="slots-row-main">
                        <strong>${esc(s.name)}</strong> ${s.ticker ? `<span class="admin-note">${esc(s.ticker)}</span>` : ""}
                        ${statusBadge(s.status)}
                        ${cooldown}
                    </div>
                    <div class="slots-row-controls">
                        <label class="slots-check">
                            <input type="checkbox" data-action="face-enabled" ${s.enabled ? "checked" : ""} ${s.hasImage ? "" : "disabled"}>
                            On reels
                        </label>
                        <label class="slots-check">
                            <input type="checkbox" data-action="face-optout" ${s.optedOut ? "checked" : ""}>
                            Opt out
                        </label>
                        <button type="button" data-action="face-upload">${s.hasImage ? "Replace image" : "Upload image"}</button>
                    </div>
                </div>
            `;

        }).join("");

        els.faces.innerHTML = `
            <div class="slots-filters">${filterHtml}</div>
            ${rows || `<p class="admin-note">Nothing in this view.</p>`}
        `;

    }

    function targetLabel(target) {
        return target === "random" ? "Random streamer (server picks)" : "Winner picks the streamer";
    }

    function prizeRow(p) {

        const thumb = p.image
            ? `<img class="slots-thumb" src="${esc(safeImageUrl(p.image))}" alt="">`
            : `<div class="slots-thumb slots-thumb-empty">?</div>`;

        return `
            <div class="slots-row slots-prize-row" data-prize-row data-prize-id="${esc(p.id)}">
                ${thumb}
                <div class="slots-fields">
                    <label>Name <input type="text" data-field="name" maxlength="30" value="${esc(p.name)}"></label>
                    <label>Points <input type="number" step="0.05" data-field="points" value="${esc(p.points)}"></label>
                    <label>Odds: 1 in <input type="number" step="1" min="2" data-field="odds" value="${esc(p.odds)}"></label>
                    <label>Who gets it
                        <select data-field="target">
                            <option value="choice" ${p.target === "choice" ? "selected" : ""}>${esc(targetLabel("choice"))}</option>
                            <option value="random" ${p.target === "random" ? "selected" : ""}>${esc(targetLabel("random"))}</option>
                        </select>
                    </label>
                    <label class="slots-check">
                        <input type="checkbox" data-field="enabled" ${p.enabled ? "checked" : ""} ${p.hasImage ? "" : "disabled"}>
                        On ${p.hasImage ? "" : "(needs image first)"}
                    </label>
                </div>
                <div class="slots-row-controls">
                    <button type="button" data-action="prize-save">Save</button>
                    <button type="button" data-action="prize-upload">${p.hasImage ? "Replace image" : "Upload image"}</button>
                    <button type="button" data-action="prize-delete" class="delete-comment">Delete</button>
                </div>
            </div>
        `;

    }

    function renderPrizes() {

        const ov = state.overview;

        els.prizes.innerHTML = `
            ${ov.prizes.map(prizeRow).join("") || `<p class="admin-note">No prizes yet.</p>`}
            <div class="slots-row slots-new-prize" id="slotsNewPrize">
                <div class="slots-fields">
                    <strong>Add a new prize</strong>
                    <label>Name <input type="text" data-new="name" maxlength="30" placeholder="e.g. Golden Cow"></label>
                    <label>Points <input type="number" step="0.05" data-new="points" placeholder="e.g. 1.5 or -0.5"></label>
                    <label>Odds: 1 in <input type="number" step="1" min="2" data-new="odds" placeholder="e.g. 1500"></label>
                    <label>Who gets it
                        <select data-new="target">
                            <option value="choice">${esc(targetLabel("choice"))}</option>
                            <option value="random">${esc(targetLabel("random"))}</option>
                        </select>
                    </label>
                </div>
                <div class="slots-row-controls">
                    <button type="button" data-action="prize-add">Add prize</button>
                    <p class="admin-note">New prizes start switched off. Upload an image, then switch it on.</p>
                </div>
            </div>
        `;

    }

    const SETTING_FIELDS = [
        ["jackpot_points", "Jackpot points", "Awarded when three of the same streamer line up."],
        ["jackpot_odds", "Jackpot odds: 1 in", "Chance of a three-face jackpot per spin. Fixed no matter how many streamers there are."],
        ["daily_spin_limit", "Spins per visitor per day", "Resets at 00:00 UTC (8pm Eastern)."],
        ["daily_streamer_cap", "Daily cap per streamer (±)", "The most any one streamer's stock can move from the slot machine in a day, up or down."],
        ["jackpot_cooldown_hours", "Jackpot cooldown (hours)", "After a jackpot, that streamer can't win another for this long."],
        ["min_streamers", "Streamers needed before the machine appears", "The machine stays hidden until this many streamers are on the reels."],
        ["min_odds_floor", "Odds floor: no prize more common than 1 in", "A typo guard — the server refuses odds more common than this."],
        ["global_daily_spin_limit", "Site-wide spins per day (circuit breaker)", "If the whole site hits this, the machine rests until tomorrow. Protects your free database allowance."]
    ];

    function renderSettings() {

        const ov = state.overview;

        const fields = SETTING_FIELDS.map(([key, label, help]) => {

            const rule = ov.settingRules[key];

            return `
                <label class="slots-setting">
                    <span class="slots-setting-label">${esc(label)}</span>
                    <input type="number" data-setting="${esc(key)}" step="${rule.int ? 1 : "any"}"
                        min="${esc(rule.min)}" max="${esc(rule.max)}" value="${esc(ov.settings[key])}">
                    <span class="admin-note">${esc(help)} (${esc(rule.min)} to ${esc(rule.max.toLocaleString())})</span>
                </label>
            `;

        }).join("");

        els.settings.innerHTML = `
            ${fields}
            <button type="button" data-action="settings-save">Save settings</button>
        `;

    }

    function renderActivity() {

        const ov = state.overview;

        const wins = ov.recentWins.map((w) => {

            const what = w.kind === "jackpot"
                ? `Jackpot on <strong>${esc(w.streamer || "?")}</strong>`
                : `${esc(w.prize || "Prize")} → <strong>${esc(w.streamer || "?")}</strong>`;

            return `<li>${esc(new Date(w.at).toLocaleString())} — ${what} (${esc(formatPoints(w.points))})
                <span class="admin-note">${w.player ? "by " + esc(w.player) : "no leaderboard name"}</span></li>`;

        }).join("");

        const board = ov.leaderboard.map((p) => `
            <li>${esc(p.name)} — ${esc(p.jackpots)}
                <button type="button" data-action="player-remove" data-name="${esc(p.name)}">Remove</button></li>
        `).join("");

        els.activity.innerHTML = `
            <div class="slots-activity-grid">
                <div>
                    <h4>Recent wins</h4>
                    ${wins ? `<ul class="slots-list">${wins}</ul>` : `<p class="admin-note">No wins yet.</p>`}
                </div>
                <div>
                    <h4>Leaderboard names</h4>
                    ${board ? `<ul class="slots-list">${board}</ul>` : `<p class="admin-note">No one has claimed a name yet.</p>`}
                </div>
            </div>
        `;

    }

    function renderAll() {
        renderPrizes();      // before status, so the live odds can read the prize rows
        renderSettings();
        renderStatus();
        renderFaces();
        renderActivity();
    }

    async function refresh() {

        const res = await api("/overview", { method: "GET" });

        if (!res.ok) {
            els.status.textContent = res.body.message || "Couldn't load the slot machine settings.";
            return false;
        }

        state.overview = res.body;
        renderAll();

        return true;

    }

    // -----------------------------------------------------------------
    // Actions
    // -----------------------------------------------------------------

    function readNumber(input) {
        return input.value.trim() === "" ? null : Number(input.value);
    }

    async function saveFace(streamerId, patch) {

        const res = await postJson("/face", { streamer_id: streamerId, ...patch });

        if (!res.ok) {
            showMessage(res.body.message || "Couldn't save that change.", "error");
        }

        await refresh();

    }

    async function savePrizeRow(row) {

        const data = {
            id: Number(row.dataset.prizeId),
            name: row.querySelector('[data-field="name"]').value,
            points: readNumber(row.querySelector('[data-field="points"]')),
            odds: readNumber(row.querySelector('[data-field="odds"]')),
            target: row.querySelector('[data-field="target"]').value,
            enabled: row.querySelector('[data-field="enabled"]').checked
        };

        const res = await postJson("/prize", data);

        if (!res.ok) {
            showMessage(res.body.message || "Couldn't save that prize.", "error");
            return;
        }

        showMessage(`Saved "${data.name}".`, "success");
        await refresh();

    }

    async function addPrize() {

        const box = document.getElementById("slotsNewPrize");

        const data = {
            name: box.querySelector('[data-new="name"]').value,
            points: readNumber(box.querySelector('[data-new="points"]')),
            odds: readNumber(box.querySelector('[data-new="odds"]')),
            target: box.querySelector('[data-new="target"]').value,
            enabled: false
        };

        const res = await postJson("/prize", data);

        if (!res.ok) {
            showMessage(res.body.message || "Couldn't add that prize.", "error");
            return;
        }

        showMessage(`Added "${data.name}". Upload its image, then switch it on.`, "success");
        await refresh();

    }

    async function deletePrizeRow(row) {

        const name = row.querySelector('[data-field="name"]').value;

        if (!confirm(`Delete the prize "${name}"? This also deletes its image and can't be undone.`)) {
            return;
        }

        const res = await postJson("/prize", { id: Number(row.dataset.prizeId) }, "DELETE");

        if (!res.ok) {
            showMessage(res.body.message || "Couldn't delete that prize.", "error");
            return;
        }

        showMessage(`Deleted "${name}".`, "success");
        await refresh();

    }

    async function saveSettings() {

        const data = {};
        let bad = false;

        els.settings.querySelectorAll("[data-setting]").forEach((input) => {

            input.classList.remove("slots-invalid");

            const value = readNumber(input);

            if (value === null || !Number.isFinite(value)) {
                input.classList.add("slots-invalid");
                bad = true;
                return;
            }

            data[input.dataset.setting] = value;

        });

        if (bad) {
            showMessage("Every setting needs a number.", "error");
            return;
        }

        const res = await postJson("/settings", data);

        if (!res.ok) {
            showMessage(res.body.message || "Couldn't save settings.", "error");
            return;
        }

        showMessage("Settings saved.", "success");
        await refresh();

    }

    async function removePlayer(name) {

        if (!confirm(`Remove "${name}" from the leaderboard? They'd be able to claim a name again on their next win.`)) {
            return;
        }

        const res = await postJson("/player-remove", { name: name });

        if (!res.ok) {
            showMessage(res.body.message || "Couldn't remove that name.", "error");
            return;
        }

        showMessage(`Removed "${name}".`, "success");
        await refresh();

    }

    // -----------------------------------------------------------------
    // Events (one delegated listener per kind, so re-rendering is safe)
    // -----------------------------------------------------------------

    root.addEventListener("click", function (event) {

        const button = event.target.closest("[data-action]");

        if (!button || button.tagName !== "BUTTON" || button.disabled) {
            return;
        }

        const action = button.dataset.action;
        const faceRow = button.closest("[data-streamer-id]");
        const prizeRowEl = button.closest("[data-prize-row]");

        switch (action) {

            case "face-filter":
                state.faceFilter = button.dataset.filter;
                renderFaces();
                break;

            case "face-upload": {
                const name = faceRow.querySelector("strong").textContent;
                pickFile("face", Number(faceRow.dataset.streamerId), name);
                break;
            }

            case "prize-upload": {
                const name = prizeRowEl.querySelector('[data-field="name"]').value || "prize";
                pickFile("prize", Number(prizeRowEl.dataset.prizeId), name);
                break;
            }

            case "prize-save":
                savePrizeRow(prizeRowEl);
                break;

            case "prize-add":
                addPrize();
                break;

            case "prize-delete":
                deletePrizeRow(prizeRowEl);
                break;

            case "settings-save":
                saveSettings();
                break;

            case "player-remove":
                removePlayer(button.dataset.name);
                break;

            case "tool-upload":
                uploadTool();
                break;

            case "tool-cancel":
                closeTool();
                break;

        }

    });

    root.addEventListener("change", function (event) {

        const target = event.target;

        if (target.name === "slotsToolMode" && state.tool) {
            state.tool.mode = target.value;
            reprocessTool();
            return;
        }

        const faceRow = target.closest("[data-streamer-id]");

        if (faceRow && target.dataset.action === "face-enabled") {
            saveFace(Number(faceRow.dataset.streamerId), { enabled: target.checked });
            return;
        }

        if (faceRow && target.dataset.action === "face-optout") {
            saveFace(Number(faceRow.dataset.streamerId), { opted_out: target.checked });
            return;
        }

    });

    // Live odds readout while typing in any prize/settings field.
    root.addEventListener("input", function (event) {

        if (event.target.closest("#slotsPrizes") || event.target.closest("#slotsSettings")) {
            renderOddsLine();
        }

    });

    root.addEventListener("change", function (event) {

        if (event.target.closest("#slotsPrizes") || event.target.closest("#slotsSettings")) {
            renderOddsLine();
        }

    });

    // Exposed so the maths and image layout can be tested on their own.
    window.CowTubeSlotsAdminTools = {
        alphaBounds, layoutFor, posterize, oddsSummary, SIZE, MARGIN, ALPHA_CUTOFF
    };

    refresh();

})();
