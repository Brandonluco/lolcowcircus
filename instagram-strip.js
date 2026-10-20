// Instagram strip: the latest posts from streamers, in a sideways-scrolling
// row in the homepage sidebar. Reads GET /api/instagram-feed (newest first).
// Tapping a tile opens the post on Instagram in a new tab.
(function () {

    "use strict";

    // ---- Display rules: change these to taste ------------------------------
    const MAX_AGE_DAYS = 30;          // hide posts older than this
    const MAX_PER_STREAMER = 2;      // at most this many tiles per streamer
    const MAX_TOTAL = 12;            // and this many overall
    // -------------------------------------------------------------------------

    const box = document.getElementById("instagramStrip");
    const track = document.getElementById("instagramStripTrack");
    const prev = document.getElementById("instagramPrev");
    const next = document.getElementById("instagramNext");

    if (!box || !track) {
        return;
    }

    // Only ever link to instagram.com and only ever load images from our own
    // cached copies or an https address — nothing else gets put on the page.
    function safePermalink(value) {
        return typeof value === "string" && /^https:\/\/(www\.)?instagram\.com\//i.test(value) ? value : null;
    }

    function safeImage(value) {
        return typeof value === "string" && (value.startsWith("/api/images/") || /^https:\/\//i.test(value)) ? value : null;
    }

    function timeAgo(ms) {

        const minutes = Math.max(0, Math.round((Date.now() - ms) / 60000));

        if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes}m ago`;

        const hours = Math.round(minutes / 60);
        if (hours < 24) return `${hours}h ago`;

        return `${Math.round(hours / 24)}d ago`;

    }

    function pickPosts(posts) {

        const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
        const perStreamer = new Map();
        const picked = [];

        // Server order is already newest first; re-sorting keeps that true
        // no matter what.
        const sorted = posts.slice().sort((a, b) => Number(b.posted_at) - Number(a.posted_at));

        for (const post of sorted) {

            if (!safePermalink(post.permalink) || !safeImage(post.image_url)) continue;
            if (!Number.isFinite(Number(post.posted_at)) || Number(post.posted_at) < cutoff) continue;

            const key = String(post.streamer_name || "").trim().toLowerCase();
            const count = perStreamer.get(key) || 0;

            if (count >= MAX_PER_STREAMER) continue;

            perStreamer.set(key, count + 1);
            picked.push(post);

            if (picked.length >= MAX_TOTAL) break;

        }

        return picked;

    }

    function buildTile(post) {

        const tile = document.createElement("a");
        tile.className = "instagram-tile";
        tile.href = safePermalink(post.permalink);
        tile.target = "_blank";
        tile.rel = "noopener noreferrer";

        const name = String(post.streamer_name || "");
        const caption = String(post.caption || "");

        tile.setAttribute("aria-label", `${name} on Instagram${caption ? ": " + caption : ""}`);

        const frame = document.createElement("span");
        frame.className = "instagram-tile-image";

        const img = document.createElement("img");
        img.src = safeImage(post.image_url);
        img.alt = "";
        img.width = 148;
        img.height = 148;
        img.loading = "lazy";
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";

        // An expired or blocked image shouldn't leave a broken tile.
        img.addEventListener("error", function () {
            tile.remove();
            if (!track.children.length) {
                box.classList.add("hidden");
            }
            updateArrows();
        });

        frame.appendChild(img);

        const nameEl = document.createElement("span");
        nameEl.className = "instagram-tile-name";
        nameEl.textContent = name;

        const captionEl = document.createElement("span");
        captionEl.className = "instagram-tile-caption";
        captionEl.textContent = caption;

        const timeEl = document.createElement("span");
        timeEl.className = "instagram-tile-time";
        timeEl.textContent = timeAgo(Number(post.posted_at));

        tile.append(frame, nameEl);

        if (caption) {
            tile.appendChild(captionEl);
        }

        tile.appendChild(timeEl);

        return tile;

    }

    function updateArrows() {

        if (!prev || !next) return;

        const maxScroll = track.scrollWidth - track.clientWidth;

        prev.hidden = track.scrollLeft <= 2;
        next.hidden = maxScroll <= 2 || track.scrollLeft >= maxScroll - 2;

    }

    function scrollByTiles(direction) {
        track.scrollBy({ left: direction * track.clientWidth * 0.8, behavior: "smooth" });
    }

    if (prev && next) {
        prev.addEventListener("click", () => scrollByTiles(-1));
        next.addEventListener("click", () => scrollByTiles(1));
    }

    track.addEventListener("scroll", updateArrows, { passive: true });
    window.addEventListener("resize", updateArrows);

    async function load() {

        try {

            const response = await fetch("/api/instagram-feed");

            if (!response.ok) {
                return;
            }

            const posts = await response.json();

            if (!Array.isArray(posts)) {
                return;
            }

            const picked = pickPosts(posts);

            if (picked.length === 0) {
                return;
            }

            track.innerHTML = "";
            picked.forEach((post) => track.appendChild(buildTile(post)));

            box.classList.remove("hidden");
            updateArrows();

        } catch (err) {
            // No strip is better than a broken one.
        }

    }

    load();

})();
