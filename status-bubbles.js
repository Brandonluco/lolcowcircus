// CowTube status bubbles — the small "what's happening" feed in the left
// gutter. Reads GET /api/status-bubbles (oldest first, newest last) and
// shows it as full glass bubbles on big screens or round icons that open on
// hover/tap on smaller ones. Layout is all CSS (status-bubbles.css); this
// file just keeps the list in sync with the server.
(function () {

    "use strict";

    const ENDPOINT = "/api/status-bubbles";
    const POLL_MS = 3 * 60 * 1000;
    const MAX_AGE_MS = 48 * 60 * 60 * 1000;
    const SEEN_KEY = "cowtubeStatusBubblesSeen";

    const root = document.getElementById("statusBubbles");

    if (!root) {
        return;
    }

    const list = root.querySelector(".status-bubbles-list");

    const TYPE_META = {
        stock:     { icon: "📈", label: "Market" },
        streak:    { icon: "🔥", label: "Streak" },
        video:     { icon: "🎬", label: "New video" },
        streamer:  { icon: "⭐", label: "New streamer" },
        milestone: { icon: "🏆", label: "Milestone" },
        info:      { icon: "💬", label: "News" }
    };

    // If a message starts with its own emoji ("📉 The Professor −0.02 …"),
    // that emoji becomes the bubble's icon instead of appearing twice.
    let leadingEmoji = null;

    try {
        leadingEmoji = new RegExp("^\\s*(\\p{Extended_Pictographic}[\\uFE0F\\u200D\\p{Extended_Pictographic}\\u{1F3FB}-\\u{1F3FF}]*)\\s*", "u");
    } catch (err) {
        leadingEmoji = null;
    }

    const wideQuery = window.matchMedia("(min-width: 1880px)");
    const visibleQuery = window.matchMedia("(min-width: 1500px)");

    const elementsById = new Map();
    let firstRender = true;
    let lastFetchAt = 0;
    let seenId = readSeenId();

    function readSeenId() {
        try {
            const raw = localStorage.getItem(SEEN_KEY);
            return raw === null ? null : Number(raw);
        } catch (err) {
            return null;
        }
    }

    function saveSeenId(id) {
        if (seenId !== null && id <= seenId) {
            return;
        }
        seenId = id;
        try {
            localStorage.setItem(SEEN_KEY, String(id));
        } catch (err) {
            // Private window etc. — the new-dot just won't persist.
        }
    }

    function timeAgo(createdAt) {

        const seconds = Math.max(0, Math.round((Date.now() - Number(createdAt)) / 1000));

        if (seconds < 60) return "just now";

        const minutes = Math.round(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;

        const hours = Math.round(minutes / 60);
        if (hours < 24) return `${hours}h ago`;

        return `${Math.round(hours / 24)}d ago`;

    }

    function buildBubble(bubble, delaySeconds) {

        const meta = TYPE_META[bubble.type] || TYPE_META.info;

        let icon = meta.icon;
        let text = String(bubble.message || "");

        if (leadingEmoji) {
            const match = text.match(leadingEmoji);
            if (match) {
                icon = match[1];
                text = text.slice(match[0].length);
            }
        }

        const item = document.createElement("li");
        item.className = "status-bubble";
        item.dataset.type = TYPE_META[bubble.type] ? bubble.type : "info";
        item.dataset.id = String(bubble.id);
        item.tabIndex = 0;
        item.setAttribute("aria-label", `${meta.label}: ${text}`);
        item.style.setProperty("--sb-delay", `${delaySeconds}s`);

        const iconEl = document.createElement("span");
        iconEl.className = "status-bubble-icon";
        iconEl.setAttribute("aria-hidden", "true");
        iconEl.textContent = icon;

        const body = document.createElement("span");
        body.className = "status-bubble-body";

        const textEl = document.createElement("span");
        textEl.className = "status-bubble-text";
        textEl.textContent = text;

        const metaEl = document.createElement("span");
        metaEl.className = "status-bubble-meta";

        const typeEl = document.createElement("span");
        typeEl.className = "status-bubble-type";
        typeEl.textContent = meta.label;

        const timeEl = document.createElement("time");
        timeEl.dateTime = new Date(Number(bubble.created_at)).toISOString();
        timeEl.dataset.createdAt = String(bubble.created_at);
        timeEl.textContent = timeAgo(bubble.created_at);

        metaEl.append(typeEl, " · ", timeEl);
        body.append(textEl, metaEl);
        item.append(iconEl, body);

        if (!wideQuery.matches && seenId !== null && Number(bubble.id) > seenId) {
            item.classList.add("is-new");
        }

        return item;

    }

    function markSeen(item) {
        item.classList.remove("is-new");
        saveSeenId(Number(item.dataset.id));
    }

    // Big-screen layout shows as many full bubbles as fit; hide the oldest
    // until nothing overflows the panel.
    function fitToHeight() {

        const items = Array.from(list.children);

        items.forEach((item) => item.classList.remove("is-clipped"));

        if (!wideQuery.matches) {
            return;
        }

        for (const item of items) {
            if (list.scrollHeight <= list.clientHeight + 1) {
                break;
            }
            item.classList.add("is-clipped");
        }

    }

    function render(bubbles) {

        const now = Date.now();

        const fresh = bubbles
            .filter((b) => b && Number.isFinite(Number(b.id)) && typeof b.message === "string" && now - Number(b.created_at) < MAX_AGE_MS)
            .sort((a, b) => Number(a.id) - Number(b.id));

        const incomingIds = new Set(fresh.map((b) => String(b.id)));

        for (const [id, el] of elementsById) {
            if (!incomingIds.has(id)) {
                el.remove();
                elementsById.delete(id);
            }
        }

        let staggerIndex = 0;

        for (const bubble of fresh) {

            const id = String(bubble.id);

            if (elementsById.has(id)) {
                continue;
            }

            const delay = firstRender ? Math.min(staggerIndex, 8) * 0.06 : 0;
            const el = buildBubble(bubble, delay);

            list.appendChild(el);
            elementsById.set(id, el);
            staggerIndex++;

        }

        // A brand-new visitor shouldn't be greeted by a pile of "new" dots.
        if (seenId === null && fresh.length > 0) {
            saveSeenId(Number(fresh[fresh.length - 1].id));
        }

        if (wideQuery.matches && fresh.length > 0) {
            saveSeenId(Number(fresh[fresh.length - 1].id));
        }

        root.hidden = elementsById.size === 0;
        firstRender = false;

        refreshTimes();
        fitToHeight();

    }

    function refreshTimes() {
        list.querySelectorAll("time[data-created-at]").forEach((el) => {
            el.textContent = timeAgo(el.dataset.createdAt);
        });
    }

    async function poll() {

        // No gutter to show it in (narrow window) — don't spend a request.
        if (!visibleQuery.matches || document.hidden) {
            return;
        }

        lastFetchAt = Date.now();

        try {

            const response = await fetch(ENDPOINT);

            if (!response.ok) {
                return;
            }

            const bubbles = await response.json();

            if (Array.isArray(bubbles)) {
                render(bubbles);
            }

        } catch (err) {
            // Network blip — keep showing what we have, try again next time.
        }

    }

    // Tap / click opens an icon's bubble on touch screens (hover does it on
    // desktop via CSS); tapping anywhere else closes it.
    list.addEventListener("click", function (event) {

        const item = event.target.closest(".status-bubble");

        if (!item) {
            return;
        }

        const wasOpen = item.classList.contains("open");

        list.querySelectorAll(".status-bubble.open").forEach((el) => el.classList.remove("open"));

        if (!wasOpen) {
            item.classList.add("open");
        }

        markSeen(item);

    });

    list.addEventListener("mouseover", function (event) {
        const item = event.target.closest(".status-bubble");
        if (item) markSeen(item);
    });

    list.addEventListener("focusin", function (event) {
        const item = event.target.closest(".status-bubble");
        if (item) markSeen(item);
    });

    document.addEventListener("click", function (event) {
        if (!event.target.closest(".status-bubble")) {
            list.querySelectorAll(".status-bubble.open").forEach((el) => el.classList.remove("open"));
        }
    });

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
            list.querySelectorAll(".status-bubble.open").forEach((el) => el.classList.remove("open"));
        }
    });

    document.addEventListener("visibilitychange", function () {
        if (!document.hidden && Date.now() - lastFetchAt > POLL_MS) {
            poll();
        }
    });

    let resizeTimer = null;

    window.addEventListener("resize", function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(fitToHeight, 150);
    });

    // Window grew wide enough to show the feed for the first time.
    visibleQuery.addEventListener("change", function () {
        if (visibleQuery.matches && elementsById.size === 0) {
            poll();
        }
    });

    wideQuery.addEventListener("change", fitToHeight);

    poll();
    setInterval(poll, POLL_MS);

})();
