// X posts banner: a black, draggable, auto-scrolling strip of recent posts
// from streamers. Reads GET /api/x-feed (newest first). Stays hidden until
// there's at least one recent post. Self-contained: everything you might
// want to tweak is in the constants below.
(function () {

    "use strict";

    const FEED_URL = "/api/x-feed";

    // Scroll speed in pixels per second. The streamer banner above moves
    // 1px per frame (about 60px/s on a 60Hz screen), so this matches it.
    // This version is time-based, so it stays 60 on faster screens too.
    const SPEED_PX_PER_SEC = 60;

    const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;   // only posts from the last 3 days
    const MAX_ITEMS = 30;
    const MAX_TEXT_CHARS = 140;                   // longer posts are cut with "…"
    const REFRESH_MS = 5 * 60 * 1000;             // re-check the feed every 5 minutes

    const banner = document.getElementById("xBanner");
    const track = document.getElementById("xTrack");
    const viewport = banner ? banner.querySelector(".x-banner-viewport") : null;

    if (!banner || !track || !viewport) {
        return;
    }

    const reduceMotion = window.matchMedia
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let posts = [];
    let offset = 0;        // current translateX, always in (-loopWidth, 0]
    let loopWidth = 0;     // width of ONE full set of posts
    let lastTs = null;
    let dragging = false;
    let moved = false;     // did the pointer actually drag (vs. a plain click)?
    let startX = 0;
    let startOffset = 0;

    function ageLabel(ms) {

        const minutes = Math.max(0, Math.round((Date.now() - ms) / 60000));

        if (minutes < 1) return "now";
        if (minutes < 60) return minutes + "m";

        const hours = Math.round(minutes / 60);
        if (hours < 24) return hours + "h";

        return Math.round(hours / 24) + "d";

    }

    function shorten(text) {

        const clean = String(text || "").replace(/\s+/g, " ").trim();

        return clean.length > MAX_TEXT_CHARS
            ? clean.slice(0, MAX_TEXT_CHARS - 1).trimEnd() + "…"
            : clean;

    }

    // Built with textContent (never innerHTML), so nothing in a post can
    // inject markup into the page.
    function buildItem(post) {

        const link = document.createElement("a");
        link.className = "x-item";
        link.href = post.permalink;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.draggable = false;

        const name = document.createElement("span");
        name.className = "x-item-name";
        name.textContent = post.streamer_name;

        const text = document.createElement("span");
        text.className = "x-item-text";
        text.textContent = shorten(post.text);

        const time = document.createElement("span");
        time.className = "x-item-time";
        time.textContent = ageLabel(Number(post.posted_at));

        link.append(name, text, time);

        return link;

    }

    function applyOffset() {
        track.style.transform = `translate3d(${offset}px, 0, 0)`;
    }

    function normalize() {

        if (loopWidth <= 0) {
            offset = 0;
            return;
        }

        while (offset <= -loopWidth) offset += loopWidth;
        while (offset > 0) offset -= loopWidth;

    }

    // Builds one set of posts, measures it, then repeats it enough times
    // that the strip never shows a gap while looping.
    function render() {

        track.replaceChildren();

        if (posts.length === 0) {
            banner.classList.add("hidden");
            loopWidth = 0;
            return;
        }

        banner.classList.remove("hidden");

        const set = document.createDocumentFragment();
        posts.forEach((post) => set.appendChild(buildItem(post)));
        track.appendChild(set);

        loopWidth = track.scrollWidth;

        if (loopWidth <= 0) {
            return;
        }

        const copies = Math.max(2, Math.ceil(viewport.clientWidth / loopWidth) + 1);
        const originals = Array.from(track.children);

        for (let i = 1; i < copies; i++) {
            originals.forEach((item) => {
                const clone = item.cloneNode(true);
                clone.setAttribute("aria-hidden", "true");
                clone.tabIndex = -1;
                track.appendChild(clone);
            });
        }

        normalize();
        applyOffset();

    }

    function tick(ts) {

        if (lastTs === null) {
            lastTs = ts;
        }

        const dt = Math.min(0.1, (ts - lastTs) / 1000);
        lastTs = ts;

        if (!dragging && !reduceMotion && loopWidth > 0) {
            offset -= SPEED_PX_PER_SEC * dt;
            normalize();
            applyOffset();
        }

        requestAnimationFrame(tick);

    }

    // ---- Drag to scroll (mouse, touch and pen) ---------------------------
    viewport.addEventListener("pointerdown", function (event) {

        if (event.pointerType === "mouse" && event.button !== 0) {
            return;
        }

        dragging = true;
        moved = false;
        startX = event.clientX;
        startOffset = offset;
        viewport.classList.add("x-dragging");

    });

    window.addEventListener("pointermove", function (event) {

        if (!dragging) {
            return;
        }

        const dx = event.clientX - startX;

        if (Math.abs(dx) > 4) {
            moved = true;
        }

        offset = startOffset + dx;
        normalize();
        applyOffset();

    });

    function endDrag() {

        if (!dragging) {
            return;
        }

        dragging = false;
        viewport.classList.remove("x-dragging");

    }

    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);

    // A drag that ends on a post shouldn't also open it.
    viewport.addEventListener("click", function (event) {

        if (moved) {
            event.preventDefault();
            event.stopPropagation();
            moved = false;
        }

    }, true);

    document.addEventListener("visibilitychange", function () {
        lastTs = null;
    });

    let resizeTimer = null;

    window.addEventListener("resize", function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(render, 200);
    });

    // ---- Data -------------------------------------------------------------
    async function load() {

        try {

            const response = await fetch(FEED_URL);

            if (!response.ok) {
                throw new Error("bad response");
            }

            const data = await response.json();
            const cutoff = Date.now() - MAX_AGE_MS;

            posts = (Array.isArray(data) ? data : [])
                .filter((p) => p
                    && typeof p.text === "string"
                    && typeof p.streamer_name === "string"
                    && typeof p.permalink === "string"
                    && Number(p.posted_at) >= cutoff)
                .slice(0, MAX_ITEMS);

            render();

        } catch (err) {
            // Leave whatever is already showing; try again next refresh.
            console.log("x-banner load failed:", err.message);
        }

    }

    load();
    setInterval(load, REFRESH_MS);
    requestAnimationFrame(tick);

})();
