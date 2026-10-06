// =====================================================================
// CowTube Slots — homepage machine
//
// Self-contained (private scope, nothing leaks into script.js) and split
// into small pieces on purpose:
//
//   * the SPIN TRIGGER  — a button today; a lever later only needs to call
//     spin() the same way (see "Spin trigger" below)
//   * the SPIN FLOW     — asks the server, handles every error, then tells
//     the reels where to land
//   * the REELS         — only animate to whatever result they're given
//
// The browser NEVER decides an outcome. It asks the server to spin and
// animates what comes back. A win shown on screen was already recorded by
// the server before the reels even started moving.
// =====================================================================

(function () {

    "use strict";

    const box = document.getElementById("slotBox");

    if (!box) {
        return;
    }

    // Public key from Cloudflare's Turnstile page. Safe to be visible.
    // Paste yours between the quotes:
    const TURNSTILE_SITE_KEY = "PASTE_YOUR_TURNSTILE_SITE_KEY_HERE";

    // The spin sound is ~3.7 seconds long, so the reels stop at about
    // 1.9s, 2.65s and 3.4s to land with it. Change spinMs / reelStaggerMs
    // to make spins shorter or longer.
    const timing = Object.assign({
        spinMs: 1900,         // first reel's spin time
        reelStaggerMs: 750,   // each later reel keeps spinning this much longer
        stripLength: 22,      // how many symbols blur past during a spin
        revealPauseMs: 250,   // beat between the reels stopping and the result text
        idleMusicMs: 180000   // music fades out after this long without a spin
    }, window.CowTubeSlotsTiming || {});

    const els = {
        reels: Array.from(box.querySelectorAll(".slot-reel")),
        readout: document.getElementById("slotReadout"),
        spin: document.getElementById("slotSpin"),
        counter: document.getElementById("slotCounter"),
        turnstile: document.getElementById("slotTurnstile"),
        lights: document.getElementById("slotLights"),
        prizesBtn: document.getElementById("slotPrizesBtn"),
        boardBtn: document.getElementById("slotBoardBtn"),
        musicBtn: document.getElementById("slotMusicBtn"),
        fxBtn: document.getElementById("slotFxBtn")
    };

    const state = {
        config: null,
        symbols: new Map(),   // "face:12" / "prize:3" -> { kind, name, image, points, target }
        current: [],          // symbol key currently showing on each reel
        spinsLeft: 0,
        busy: false,
        overlay: null,
        passRequired: false,
        hasPass: false
    };

    // -----------------------------------------------------------------
    // Small helpers
    // -----------------------------------------------------------------

    // Builds elements with textContent only — names from the server are
    // never parsed as HTML.
    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function safeImageUrl(url) {
        return typeof url === "string" && url.startsWith("/api/images/") ? url : "";
    }

    function formatPoints(value) {
        const rounded = Math.round(Number(value) * 100) / 100;
        return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}`;
    }

    function prefersReducedMotion() {
        return typeof window.matchMedia === "function"
            && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function pickRandom(list) {
        return list[Math.floor(Math.random() * list.length)];
    }

    async function request(path, options) {

        let response;

        try {
            response = await fetch(path, Object.assign({ credentials: "same-origin" }, options));
        } catch (err) {
            return { status: 0, body: { error: "network" } };
        }

        let body = {};

        try {
            body = await response.json();
        } catch {
            body = {};
        }

        return { status: response.status, body: body };

    }

    function postJson(path, data) {
        return request(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data || {})
        });
    }

    function setMessage(text, kind) {
        els.readout.textContent = text;
        els.readout.className = "slot-readout" + (kind ? ` slot-readout-${kind}` : "");
    }

    function flash(className) {
        box.classList.remove("slot-win", "slot-penalty");
        void box.offsetWidth; // restart the animation if it was already running
        box.classList.add(className);
        setTimeout(() => box.classList.remove(className), 1800);
    }

    // The homepage's mini stock chart lives in script.js; refresh it after
    // a win if it's there.
    function refreshStockWidget() {
        try {
            if (typeof loadStockGraph === "function") {
                loadStockGraph();
            }
        } catch (err) {
            // never let a chart refresh break the machine
        }
    }

    // -----------------------------------------------------------------
    // Symbols and reels
    // -----------------------------------------------------------------

    function loadSymbols(cfg) {

        state.symbols = new Map();

        for (const face of cfg.faces) {
            state.symbols.set(`face:${face.id}`, { kind: "face", name: face.name, image: safeImageUrl(face.image) });
        }

        for (const prize of cfg.prizes) {
            state.symbols.set(`prize:${prize.id}`, {
                kind: "prize",
                name: prize.name,
                image: safeImageUrl(prize.image),
                points: prize.points,
                target: prize.target
            });
        }

    }

    function symbolElement(key) {

        const info = state.symbols.get(key);
        const sym = el("div", "slot-sym" + (info && info.kind === "prize" ? " slot-sym-prize" : ""));

        if (info && info.image) {
            const img = document.createElement("img");
            img.src = info.image;
            img.alt = "";
            img.draggable = false;
            sym.appendChild(img);
        }

        return sym;

    }

    function keyOf(ref) {
        return `${ref.type}:${ref.id}`;
    }

    function showStatic(reelIndex, key) {
        els.reels[reelIndex].querySelector(".slot-strip").replaceChildren(symbolElement(key));
        state.current[reelIndex] = key;
    }

    function randomResting() {

        const pool = Array.from(state.symbols.keys());

        // Never rest on three of a kind — that would look like a win.
        for (let attempt = 0; attempt < 20; attempt++) {
            const picks = [pickRandom(pool), pickRandom(pool), pickRandom(pool)];
            if (!(picks[0] === picks[1] && picks[1] === picks[2])) {
                return picks;
            }
        }

        return [pool[0], pool[1 % pool.length], pool[2 % pool.length]];

    }

    function animateReel(reelIndex, finalKey, durationMs) {

        return new Promise((resolve) => {

            const strip = els.reels[reelIndex].querySelector(".slot-strip");
            const pool = Array.from(state.symbols.keys());
            const count = timing.stripLength;

            const keys = [state.current[reelIndex]];

            for (let i = 0; i < count; i++) {
                keys.push(pickRandom(pool));
            }

            keys.push(finalKey);

            strip.replaceChildren(...keys.map(symbolElement));
            strip.style.transition = "none";
            strip.style.transform = "translateY(0)";
            void strip.offsetHeight;

            let finished = false;

            const finish = () => {

                if (finished) {
                    return;
                }

                finished = true;
                strip.removeEventListener("transitionend", onEnd);
                strip.style.transition = "none";
                strip.style.transform = "translateY(0)";
                showStatic(reelIndex, finalKey);
                resolve();

            };

            const onEnd = (event) => {
                if (event.target === strip && event.propertyName === "transform") {
                    finish();
                }
            };

            strip.addEventListener("transitionend", onEnd);

            // The strip has count + 2 symbols; slide down to the last one.
            const distance = ((count + 1) / (count + 2)) * 100;

            requestAnimationFrame(() => {
                strip.style.transition = `transform ${durationMs}ms cubic-bezier(0.12, 0.72, 0.18, 1)`;
                strip.style.transform = `translateY(-${distance}%)`;
            });

            // Safety net: if the browser never fires transitionend (hidden tab,
            // reduced motion, etc.) the reel still lands.
            setTimeout(finish, durationMs + 300);

        });

    }

    async function animateReels(refs) {

        const reduce = prefersReducedMotion();

        box.classList.add("slot-spinning");

        const finals = refs.map(keyOf);

        const runs = finals.map((key, i) =>
            animateReel(i, key, reduce ? 1 : timing.spinMs + i * timing.reelStaggerMs)
        );

        await Promise.all(runs);

        box.classList.remove("slot-spinning");

        els.reels.forEach((reel, i) => {
            const info = state.symbols.get(finals[i]);
            reel.setAttribute("aria-label", `Reel ${i + 1}: ${info ? info.name : ""}`);
        });

    }

    // -----------------------------------------------------------------
    // Counter / button state
    // -----------------------------------------------------------------

    function updateCounter() {

        const strong = el("strong", "", String(state.spinsLeft));

        els.counter.replaceChildren(strong, document.createTextNode(state.spinsLeft === 1 ? "spin left" : "spins left"));

        if (state.spinsLeft <= 0) {
            els.spin.textContent = "OUT OF SPINS";
            els.spin.disabled = true;
        } else if (!state.busy) {
            els.spin.textContent = "SPIN";
            els.spin.disabled = false;
        }

    }

    function setBusy(busy) {

        state.busy = busy;

        if (busy) {
            els.spin.disabled = true;
            els.spin.textContent = "...";
        } else {
            updateCounter();
        }

    }

    // -----------------------------------------------------------------
    // Human check (Cloudflare Turnstile) — once per visit, not per spin
    // -----------------------------------------------------------------

    let turnstileScript = null;
    let widgetId = null;
    let pendingToken = null;

    function loadTurnstileScript() {

        if (window.turnstile) {
            return Promise.resolve();
        }

        if (!turnstileScript) {

            turnstileScript = new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
                script.async = true;
                script.onload = () => resolve();
                script.onerror = () => { turnstileScript = null; reject(new Error("blocked")); };
                document.head.appendChild(script);
            });

        }

        return turnstileScript;

    }

    function siteKeyMissing() {
        return !TURNSTILE_SITE_KEY || TURNSTILE_SITE_KEY.startsWith("PASTE_");
    }

    function getToken() {

        return new Promise((resolve) => {

            pendingToken = resolve;

            els.turnstile.classList.remove("hidden");

            if (widgetId === null) {

                widgetId = window.turnstile.render(els.turnstile, {
                    sitekey: TURNSTILE_SITE_KEY,
                    // Invisible unless Cloudflare decides the visitor needs a click.
                    appearance: "interaction-only",
                    callback: (token) => {
                        if (pendingToken) { const done = pendingToken; pendingToken = null; done(token); }
                    },
                    "error-callback": () => {
                        if (pendingToken) { const done = pendingToken; pendingToken = null; done(null); }
                    }
                });

            } else {
                window.turnstile.reset(widgetId);
            }

            // Don't leave the visitor waiting forever.
            setTimeout(() => {
                if (pendingToken === resolve) { pendingToken = null; resolve(null); }
            }, 30000);

        });

    }

    async function ensurePass() {

        if (!state.passRequired || state.hasPass) {
            return true;
        }

        if (siteKeyMissing()) {
            setMessage("The machine isn't fully set up yet.", "error");
            return false;
        }

        setMessage("Checking that you're human…");

        try {
            await loadTurnstileScript();
        } catch (err) {
            setMessage("Couldn't load the human check. If you use an ad blocker, try turning it off for this site.", "error");
            return false;
        }

        const token = await getToken();

        els.turnstile.classList.add("hidden");

        if (!token) {
            setMessage("The human check didn't complete. Please try again.", "error");
            return false;
        }

        const res = await postJson("/api/slots/verify", { token: token });

        if (res.status !== 200) {
            setMessage("The human check failed. Please try again.", "error");
            return false;
        }

        state.hasPass = true;

        return true;

    }

    // -----------------------------------------------------------------
    // Overlays (prize pick, name, prizes list, leaderboard)
    // -----------------------------------------------------------------

    function closeOverlay() {

        if (!state.overlay) {
            return;
        }

        if (state.overlay.timer) {
            clearInterval(state.overlay.timer);
        }

        state.overlay.node.remove();
        state.overlay = null;

    }

    function openOverlay(node, options) {

        closeOverlay();

        node.classList.add("slot-overlay");
        node.setAttribute("role", "dialog");
        node.setAttribute("aria-modal", "true");
        box.appendChild(node);

        state.overlay = Object.assign({ node: node, timer: null, escapeCloses: true }, options || {});

        const first = node.querySelector("input, button");

        if (first) {
            first.focus({ preventScroll: true });
        }

    }

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && state.overlay && state.overlay.escapeCloses) {
            closeOverlay();
        }
    });

    function closeButton() {
        const button = el("button", "slot-btn slot-btn-quiet", "Close");
        button.type = "button";
        button.addEventListener("click", closeOverlay);
        return button;
    }

    function showPrizes() {

        const node = el("div");
        node.appendChild(el("h3", "", "Prizes"));
        node.appendChild(el("p", "", "Wins move that streamer's price on the stock page."));

        const table = el("table", "slot-table");

        const rows = [];

        rows.push(prizeRow(null, "Three of the same streamer", "That streamer", state.config.jackpotPoints));

        for (const prize of state.config.prizes) {
            rows.push(prizeRow(prize.image, prize.name, prize.target === "random" ? "A random streamer" : "You pick the streamer", prize.points));
        }

        table.append(...rows);
        node.appendChild(table);

        const buttons = el("div", "slot-overlay-buttons");
        buttons.appendChild(closeButton());
        node.appendChild(buttons);

        openOverlay(node);

    }

    function prizeRow(image, title, target, points) {

        const tr = el("tr");

        const imgCell = el("td");

        if (image && safeImageUrl(image)) {
            const img = document.createElement("img");
            img.src = safeImageUrl(image);
            img.alt = "";
            imgCell.appendChild(img);
        }

        const textCell = el("td");
        textCell.appendChild(el("strong", "", title));
        textCell.appendChild(el("div", "", target));
        textCell.lastChild.style.cssText = "font-size:0.75rem;color:#9a9aa3";

        const pts = el("td", `slot-pts ${points < 0 ? "slot-pts-down" : "slot-pts-up"}`, formatPoints(points));

        tr.append(imgCell, textCell, pts);

        return tr;

    }

    async function showLeaderboard() {

        const node = el("div");
        node.appendChild(el("h3", "", "🏆 Leaderboard"));
        const body = el("p", "", "Loading…");
        node.appendChild(body);

        const buttons = el("div", "slot-overlay-buttons");
        buttons.appendChild(closeButton());
        node.appendChild(buttons);

        openOverlay(node);

        const res = await request("/api/slots/leaderboard");

        if (state.overlay && state.overlay.node !== node) {
            return;
        }

        if (res.status !== 200 || !Array.isArray(res.body)) {
            body.textContent = "Couldn't load the leaderboard right now.";
            return;
        }

        if (res.body.length === 0) {
            body.textContent = "No winners yet. Be the first!";
            return;
        }

        const table = el("table", "slot-table");

        res.body.forEach((row, index) => {
            const tr = el("tr");
            tr.append(
                el("td", "slot-rank", `#${index + 1}`),
                el("td", "", row.name),
                el("td", "slot-pts", `${row.jackpots} ${row.jackpots === 1 ? "win" : "wins"}`)
            );
            table.appendChild(tr);
        });

        body.replaceWith(table);

    }

    // ----- Name prompt (first win) -----

    function promptForName() {

        const node = el("div");
        node.appendChild(el("h3", "", "🏆 You're on the board!"));
        node.appendChild(el("p", "", "Pick a name for the leaderboard (3–20 characters). You can't change it afterwards."));

        const input = el("input", "slot-name-input");
        input.type = "text";
        input.maxLength = 20;
        input.setAttribute("aria-label", "Leaderboard name");

        const chatName = localStorage.getItem("chatUsername");

        if (chatName && /^[A-Za-z0-9 _.\-]{3,20}$/.test(chatName)) {
            input.value = chatName;
        }

        const error = el("p", "slot-form-error");

        const save = el("button", "slot-btn", "Save name");
        save.type = "button";

        const skip = el("button", "slot-btn slot-btn-quiet", "Not now");
        skip.type = "button";
        skip.addEventListener("click", closeOverlay);

        const submit = async () => {

            save.disabled = true;
            error.textContent = "";

            const res = await postJson("/api/slots/name", { name: input.value });

            if (res.status === 200) {
                closeOverlay();
                setMessage(`Welcome to the leaderboard, ${res.body.name}!`, "win");
                return;
            }

            error.textContent = res.body.message || "Couldn't save that name. Try another.";
            save.disabled = false;

        };

        save.addEventListener("click", submit);
        input.addEventListener("keydown", (event) => { if (event.key === "Enter") submit(); });

        const buttons = el("div", "slot-overlay-buttons");
        buttons.append(save, skip);

        node.append(input, error, buttons);

        openOverlay(node);

    }

    // ----- "Pick your streamer" (winner's-choice prizes) -----

    function promptForPick(result) {

        const prize = result.prize;
        const node = el("div");

        node.appendChild(el("h3", "", `🎁 ${prize.name}!`));
        node.appendChild(el("p", "", `${formatPoints(prize.points)} to the streamer of your choice. Pick one:`));

        const grid = el("div", "slot-pick-grid");
        const error = el("p", "slot-form-error");
        const timer = el("div", "slot-timer");

        let remaining = result.expiresInSeconds || 600;
        let resolved = false;

        const buttons = [];

        for (const streamer of result.pickList) {

            const button = el("button", "slot-pick");
            button.type = "button";
            button.dataset.streamerId = String(streamer.id);

            const img = document.createElement("img");
            img.src = safeImageUrl(streamer.image);
            img.alt = "";
            button.append(img, el("span", "", streamer.name));

            button.addEventListener("click", async () => {

                if (resolved) {
                    return;
                }

                buttons.forEach((b) => { b.disabled = true; });
                error.textContent = "";

                const res = await postJson("/api/slots/claim", { token: result.token, streamer_id: streamer.id });

                if (res.status === 200) {

                    resolved = true;
                    closeOverlay();
                    setMessage(`${res.body.win.streamerName} ${formatPoints(res.body.win.points)}!`, "win");
                    flash("slot-win");
                    refreshStockWidget();

                    if (res.body.needsName) {
                        promptForName();
                    }

                    return;

                }

                if (res.status === 409) {
                    error.textContent = `${streamer.name} has hit today's limit — pick someone else.`;
                    button.remove();
                    buttons.splice(buttons.indexOf(button), 1);
                    buttons.forEach((b) => { b.disabled = false; });
                    return;
                }

                if (res.body && res.body.error === "invalid_or_expired_token") {
                    resolved = true;
                    error.textContent = "This prize has expired.";
                    setTimeout(closeOverlay, 1800);
                    return;
                }

                error.textContent = "Something went wrong. Please try again.";
                buttons.forEach((b) => { b.disabled = false; });

            });

            buttons.push(button);
            grid.appendChild(button);

        }

        const renderTimer = () => {
            const m = Math.floor(remaining / 60);
            const s = String(remaining % 60).padStart(2, "0");
            timer.textContent = `Choose within ${m}:${s} or the prize is forfeited.`;
        };

        renderTimer();

        const giveUp = el("button", "slot-btn slot-btn-quiet", "Forfeit prize");
        giveUp.type = "button";
        giveUp.addEventListener("click", () => {
            if (confirm("Close without choosing? You'll forfeit this prize.")) {
                resolved = true;
                closeOverlay();
                setMessage("Prize forfeited. Spin again!");
            }
        });

        const row = el("div", "slot-overlay-buttons");
        row.appendChild(giveUp);

        node.append(grid, error, timer, row);

        // A real choice: Escape must not silently throw the prize away.
        openOverlay(node, { escapeCloses: false });

        state.overlay.timer = setInterval(() => {

            remaining -= 1;

            if (remaining <= 0) {
                resolved = true;
                closeOverlay();
                setMessage("The prize expired. Spin again!");
                return;
            }

            renderTimer();

        }, 1000);

    }

    // -----------------------------------------------------------------
    // Sound
    //
    //   * MUSIC   — the song. Starts on the first spin of a visit (browsers
    //               only allow sound after a click), loops, and is the only
    //               thing the music button mutes.
    //   * EFFECTS — the reel-spin sound and the button click. Own button.
    //               The very press that starts the music has no click, so the
    //               two never collide.
    //
    // Everything goes through Web Audio gain nodes so the volumes below are
    // honored on iPhones too (they ignore a plain <audio> volume). Nothing
    // is downloaded until it's needed, and any audio problem is swallowed —
    // a missing file or blocked sound can never stop the machine working.
    // -----------------------------------------------------------------

    const AUDIO = {
        musicUrl: "Audio/one-armed-bandit.mp3",
        spinUrl: "Audio/slot-spin.mp3",
        clickUrl: "Audio/slot-button-click.mp3",
        musicVolume: 0.30,          // the song leads...
        spinVolume: 0.35,           // ...the spin sound sits underneath it
        clickVolume: 0.50,
        fxBoostWhenMusicOff: 1.6,   // effects get a bit louder when the song is muted
        musicFadeInSec: 1.5,
        musicFadeOutSec: 0.5
    };

    function readPref(key) {
        try { return localStorage.getItem(key) === "1"; } catch (err) { return false; }
    }

    function writePref(key, on) {
        try { localStorage.setItem(key, on ? "1" : "0"); } catch (err) { /* private mode */ }
    }

    const sound = {
        ctx: null,
        musicGain: null,
        fxGain: null,
        musicEl: null,
        buffers: {},
        loading: {},
        musicMuted: readPref("slotMusicMuted"),
        fxMuted: readPref("slotFxMuted"),
        musicWanted: false,
        pausedByTab: false,
        idleTimer: null,
        spinNode: null
    };

    function ensureContext() {

        if (sound.ctx) {
            return sound.ctx;
        }

        const AudioCtx = window.AudioContext || window.webkitAudioContext;

        if (!AudioCtx) {
            return null;
        }

        try {
            const ctx = new AudioCtx();
            sound.ctx = ctx;
            sound.musicGain = ctx.createGain();
            sound.musicGain.gain.value = 0;
            sound.fxGain = ctx.createGain();
            sound.musicGain.connect(ctx.destination);
            sound.fxGain.connect(ctx.destination);
            applyFxLevel();
            return ctx;
        } catch (err) {
            return null;
        }

    }

    function resumeContext(ctx) {

        if (ctx.state === "suspended") {
            try {
                const result = ctx.resume();
                if (result && result.catch) result.catch(() => {});
            } catch (err) { /* ignore */ }
        }

    }

    function applyFxLevel() {

        if (sound.fxGain) {
            sound.fxGain.gain.value = sound.musicMuted ? AUDIO.fxBoostWhenMusicOff : 1;
        }

    }

    // Fetches and decodes a short sound once, then keeps it.
    function loadBuffer(name, url) {

        if (sound.buffers[name]) {
            return Promise.resolve(sound.buffers[name]);
        }

        if (!sound.loading[name]) {

            sound.loading[name] = fetch(url)
                .then((response) => {
                    if (!response.ok) throw new Error("http " + response.status);
                    return response.arrayBuffer();
                })
                .then((data) => new Promise((resolve, reject) => {
                    const maybe = sound.ctx.decodeAudioData(data, resolve, reject);
                    if (maybe && maybe.then) maybe.then(resolve, reject);
                }))
                .then((buffer) => {
                    sound.buffers[name] = buffer;
                    return buffer;
                })
                .catch(() => {
                    sound.loading[name] = null;   // allow a retry on a later spin
                    return null;
                });

        }

        return sound.loading[name];

    }

    function playBuffer(name, volume) {

        const buffer = sound.buffers[name];

        if (!buffer || !sound.ctx || sound.fxMuted) {
            return null;
        }

        try {
            const source = sound.ctx.createBufferSource();
            const gain = sound.ctx.createGain();
            source.buffer = buffer;
            gain.gain.value = volume;
            source.connect(gain);
            gain.connect(sound.fxGain);
            source.start();
            return { source: source, gain: gain };
        } catch (err) {
            return null;
        }

    }

    function stopSpinSound() {

        if (sound.spinNode) {
            try { sound.spinNode.source.stop(); } catch (err) { /* already ended */ }
            sound.spinNode = null;
        }

    }

    function rampMusic(target, seconds) {

        if (!sound.ctx || !sound.musicGain) {
            return;
        }

        const gain = sound.musicGain.gain;
        const now = sound.ctx.currentTime;

        gain.cancelScheduledValues(now);
        gain.setValueAtTime(gain.value, now);
        gain.linearRampToValueAtTime(target, now + seconds);

    }

    function armIdleTimer() {

        clearTimeout(sound.idleTimer);

        sound.idleTimer = setTimeout(() => {
            if (sound.musicWanted) {
                stopMusic();
            }
        }, timing.idleMusicMs);

    }

    function startMusic() {

        if (sound.musicMuted || !sound.ctx) {
            return;
        }

        try {

            if (!sound.musicEl) {

                const element = new Audio(AUDIO.musicUrl);
                element.loop = true;
                element.preload = "auto";

                try {
                    sound.ctx.createMediaElementSource(element).connect(sound.musicGain);
                } catch (err) {
                    // Couldn't route through Web Audio: fall back to the plain element volume.
                    element.volume = AUDIO.musicVolume;
                    sound.musicGain.gain.value = 1;
                }

                sound.musicEl = element;

            }

            const played = sound.musicEl.play();
            if (played && played.catch) played.catch(() => {});

            rampMusic(AUDIO.musicVolume, AUDIO.musicFadeInSec);

            sound.musicWanted = true;
            sound.pausedByTab = false;
            armIdleTimer();

        } catch (err) {
            // sound is optional
        }

    }

    function stopMusic() {

        sound.musicWanted = false;
        clearTimeout(sound.idleTimer);

        if (!sound.musicEl) {
            return;
        }

        rampMusic(0, AUDIO.musicFadeOutSec);

        setTimeout(() => {
            if (!sound.musicWanted && sound.musicEl) {
                try { sound.musicEl.pause(); } catch (err) { /* ignore */ }
            }
        }, AUDIO.musicFadeOutSec * 1000 + 60);

    }

    // Called at the very top of spin(), inside the click, so the browser
    // lets sound start.
    function onPress() {

        const ctx = ensureContext();

        if (!ctx) {
            return;
        }

        resumeContext(ctx);

        let musicStartedNow = false;

        if (!sound.musicMuted) {
            if (!sound.musicWanted) {
                startMusic();
                musicStartedNow = true;
            } else {
                armIdleTimer();
            }
        }

        if (sound.fxMuted) {
            return;
        }

        // Fetch both effects now (small files) so they're ready when needed.
        loadBuffer("spin", AUDIO.spinUrl);
        loadBuffer("click", AUDIO.clickUrl);

        // The press that starts the song stays click-free.
        if (!musicStartedNow) {
            playBuffer("click", AUDIO.clickVolume);
        }

    }

    // Called when the server's answer arrives, just as the reels start.
    async function playSpinSound() {

        if (sound.fxMuted || !sound.ctx || prefersReducedMotion()) {
            return;
        }

        const buffer = await Promise.race([
            loadBuffer("spin", AUDIO.spinUrl),
            new Promise((resolve) => setTimeout(() => resolve(null), 500))
        ]);

        if (!buffer || sound.fxMuted) {
            return;
        }

        stopSpinSound();
        sound.spinNode = playBuffer("spin", AUDIO.spinVolume);

    }

    function syncSoundButtons() {

        const set = (button, muted, label) => {
            button.classList.toggle("slot-sound-off", muted);
            button.setAttribute("aria-pressed", String(!muted));
            button.setAttribute("aria-label", `${label}: ${muted ? "off" : "on"}`);
            button.title = `${label} — click to turn ${muted ? "on" : "off"}`;
        };

        set(els.musicBtn, sound.musicMuted, "Music");
        set(els.fxBtn, sound.fxMuted, "Sound effects");

    }

    function setMusicMuted(muted) {

        sound.musicMuted = muted;
        writePref("slotMusicMuted", muted);
        syncSoundButtons();
        applyFxLevel();

        if (muted) {
            stopMusic();
            return;
        }

        // Unmuting is itself a click, so sound is allowed. If they've already
        // spun this visit, bring the song straight back in.
        const ctx = ensureContext();

        if (ctx && sound.hasSpun) {
            resumeContext(ctx);
            startMusic();
        }

    }

    function setFxMuted(muted) {

        sound.fxMuted = muted;
        writePref("slotFxMuted", muted);
        syncSoundButtons();

        if (muted) {
            stopSpinSound();
        }

    }

    // Don't keep playing into a background tab.
    document.addEventListener("visibilitychange", () => {

        if (!sound.musicEl) {
            return;
        }

        if (document.hidden) {
            if (sound.musicWanted && !sound.musicEl.paused) {
                try { sound.musicEl.pause(); } catch (err) { /* ignore */ }
                sound.pausedByTab = true;
            }
        } else if (sound.pausedByTab && sound.musicWanted) {
            sound.pausedByTab = false;
            try {
                const played = sound.musicEl.play();
                if (played && played.catch) played.catch(() => {});
            } catch (err) { /* ignore */ }
        }

    });

    // -----------------------------------------------------------------
    // The spin itself
    // -----------------------------------------------------------------

    const FLAVOR_MISS = ["No luck. Try again!", "Not this time…", "So close. Spin again!", "The cows aren't aligned yet."];

    function nearMiss(refs) {
        const keys = refs.map(keyOf);
        return new Set(keys).size === 2;
    }

    async function requestSpin() {

        let res = await postJson("/api/slots/spin", {});

        // The one-hour human-check pass ran out: renew it and retry once.
        if (res.status === 403 && res.body.error === "verify_required") {

            state.hasPass = false;

            if (!(await ensurePass())) {
                return null;
            }

            res = await postJson("/api/slots/spin", {});

        }

        return res;

    }

    async function spin() {

        if (state.busy || state.spinsLeft <= 0 || state.overlay) {
            return;
        }

        // Must run right here, synchronously inside the click, or browsers
        // won't let the sound start. Wrapped so audio can never block a spin.
        try {
            sound.hasSpun = true;
            onPress();
        } catch (err) { /* sound is optional */ }

        setBusy(true);
        setMessage("");

        if (!(await ensurePass())) {
            setBusy(false);
            return;
        }

        setMessage("Spinning…");

        const res = await requestSpin();

        if (!res) {
            setBusy(false);
            return;
        }

        if (res.status !== 200) {

            const code = res.body && res.body.error;

            if (code === "daily_limit") {
                state.spinsLeft = 0;
                setMessage("You're out of spins for today. Come back tomorrow!", "error");
            } else if (code === "machine_resting") {
                setMessage("The machine is resting for today. Come back tomorrow!", "error");
            } else if (code === "machine_unavailable") {
                box.classList.add("hidden");
            } else if (code === "banned") {
                setMessage("You can't use the slot machine.", "error");
            } else {
                setMessage("Something went wrong. Please try again.", "error");
            }

            setBusy(false);
            return;

        }

        const result = res.body;

        state.spinsLeft = result.spinsLeft;

        try { playSpinSound(); } catch (err) { /* sound is optional */ }

        await animateReels(result.reels);
        await new Promise((resolve) => setTimeout(resolve, timing.revealPauseMs));

        setBusy(false);

        switch (result.outcome) {

            case "jackpot":
                setMessage(`🎉 JACKPOT! ${result.win.streamerName} ${formatPoints(result.win.points)}`, "win");
                flash("slot-win");
                refreshStockWidget();
                if (result.needsName) promptForName();
                break;

            case "prize_random":
                setMessage(`💀 ${result.prize.name}! ${result.win.streamerName} ${formatPoints(result.win.points)}`, "penalty");
                flash("slot-penalty");
                refreshStockWidget();
                break;

            case "prize_choice":
                setMessage(`🎁 ${result.prize.name}! Choose a streamer.`, "win");
                flash("slot-win");
                promptForPick(result);
                break;

            default:
                setMessage(nearMiss(result.reels) ? "So close!" : pickRandom(FLAVOR_MISS));

        }

    }

    // -----------------------------------------------------------------
    // Spin trigger — the ONLY thing that knows about the button.
    // A lever (or anything else) just has to call spin() as well.
    // -----------------------------------------------------------------

    els.spin.addEventListener("click", spin);

    els.prizesBtn.addEventListener("click", () => { if (state.config) showPrizes(); });
    els.boardBtn.addEventListener("click", showLeaderboard);

    els.musicBtn.addEventListener("click", () => setMusicMuted(!sound.musicMuted));
    els.fxBtn.addEventListener("click", () => setFxMuted(!sound.fxMuted));

    syncSoundButtons();

    // Warm up the human check as soon as the visitor shows interest, so
    // their first spin doesn't wait on a script download.
    ["pointerenter", "focusin", "touchstart"].forEach((name) => {
        box.addEventListener(name, () => {
            if (state.passRequired && !state.hasPass && !siteKeyMissing()) {
                loadTurnstileScript().catch(() => {});
            }
        }, { once: true, passive: true });
    });

    // -----------------------------------------------------------------
    // Startup
    // -----------------------------------------------------------------

    function buildLights() {

        for (let i = 0; i < 22; i++) {
            els.lights.appendChild(document.createElement("span"));
        }

    }

    async function init() {

        const res = await request("/api/slots/config");

        // Not ready (or the server isn't reachable): the machine simply
        // never appears. Visitors never see a half-built machine.
        if (res.status !== 200 || !res.body.available) {
            return;
        }

        state.config = res.body;
        state.spinsLeft = res.body.spinsLeft;
        state.passRequired = !!res.body.passRequired;
        state.hasPass = !!res.body.hasPass;

        loadSymbols(res.body);

        buildLights();

        randomResting().forEach((key, i) => showStatic(i, key));

        if (state.spinsLeft <= 0) {
            setMessage("You're out of spins for today. Come back tomorrow!", "error");
        } else {
            setMessage("Press SPIN to play!");
        }

        updateCounter();

        box.classList.remove("hidden");

    }

    init();

})();
