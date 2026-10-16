// CowTube Updates page: the past 3 days of status bubbles, grouped by day,
// with a filter by type. Reads GET /api/status-bubbles/history (newest first).
(function () {

    "use strict";

    const TYPE_META = {
        stock:     { icon: "📈", label: "Market" },
        streak:    { icon: "🔥", label: "Streak" },
        video:     { icon: "🎬", label: "New video" },
        streamer:  { icon: "⭐", label: "New streamer" },
        milestone: { icon: "🏆", label: "Milestone" },
        cow:       { icon: "🐄", label: "Cow Updates" },
        info:      { icon: "💬", label: "News" }
    };

    const listEl = document.getElementById("updatesList");
    const filtersEl = document.getElementById("updatesFilters");

    let allUpdates = [];
    let activeFilter = "all";

    // A message that starts with its own emoji uses it as the icon.
    let leadingEmoji = null;

    try {
        leadingEmoji = new RegExp("^\\s*(\\p{Extended_Pictographic}[\\uFE0F\\u200D\\p{Extended_Pictographic}\\u{1F3FB}-\\u{1F3FF}]*)\\s*", "u");
    } catch (err) {
        leadingEmoji = null;
    }

    function dayKey(ms) {
        const d = new Date(ms);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    }

    function dayLabel(ms) {

        const now = new Date();
        const key = dayKey(ms);

        if (key === dayKey(now.getTime())) return "Today";

        const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        if (key === dayKey(yesterday.getTime())) return "Yesterday";

        return new Date(ms).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

    }

    function timeLabel(ms) {
        return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    }

    function buildCard(update) {

        const meta = TYPE_META[update.type] || TYPE_META.info;

        let icon = meta.icon;
        let text = String(update.message || "");

        if (leadingEmoji) {
            const match = text.match(leadingEmoji);
            if (match) {
                icon = match[1];
                text = text.slice(match[0].length);
            }
        }

        const card = document.createElement("article");
        card.className = "update-card";
        card.dataset.type = TYPE_META[update.type] ? update.type : "info";

        const iconEl = document.createElement("span");
        iconEl.className = "update-icon";
        iconEl.setAttribute("aria-hidden", "true");
        iconEl.textContent = icon;

        const body = document.createElement("div");
        body.className = "update-body";

        const textEl = document.createElement("span");
        textEl.className = "update-text";
        textEl.textContent = text;

        const metaEl = document.createElement("span");
        metaEl.className = "update-meta";

        const typeEl = document.createElement("span");
        typeEl.className = "update-type";
        typeEl.textContent = meta.label;

        const timeEl = document.createElement("time");
        timeEl.dateTime = new Date(Number(update.created_at)).toISOString();
        timeEl.textContent = timeLabel(Number(update.created_at));

        metaEl.append(typeEl, " · ", timeEl);
        body.append(textEl, metaEl);
        card.append(iconEl, body);

        return card;

    }

    function renderFilters() {

        // Only offer filters for types that actually appear.
        const present = new Set(allUpdates.map((u) => TYPE_META[u.type] ? u.type : "info"));

        filtersEl.innerHTML = "";

        if (present.size < 2) {
            return;
        }

        const makeButton = (key, label) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "updates-filter" + (key === activeFilter ? " updates-filter-active" : "");
            button.dataset.filter = key;
            button.textContent = label;
            return button;
        };

        filtersEl.appendChild(makeButton("all", "All"));

        Object.keys(TYPE_META).forEach((key) => {
            if (present.has(key)) {
                filtersEl.appendChild(makeButton(key, `${TYPE_META[key].icon} ${TYPE_META[key].label}`));
            }
        });

    }

    function renderList() {

        const shown = allUpdates.filter((u) => activeFilter === "all" || (TYPE_META[u.type] ? u.type : "info") === activeFilter);

        listEl.innerHTML = "";

        if (shown.length === 0) {
            const empty = document.createElement("p");
            empty.className = "updates-empty";
            empty.textContent = allUpdates.length === 0
                ? "No updates in the past 3 days."
                : "No updates of this type in the past 3 days.";
            listEl.appendChild(empty);
            return;
        }

        let currentKey = null;
        let dayEl = null;

        for (const update of shown) {

            const key = dayKey(Number(update.created_at));

            if (key !== currentKey) {

                currentKey = key;

                const heading = document.createElement("h2");
                heading.className = "updates-day-heading";
                heading.textContent = dayLabel(Number(update.created_at));
                listEl.appendChild(heading);

                dayEl = document.createElement("div");
                dayEl.className = "updates-day";
                listEl.appendChild(dayEl);

            }

            dayEl.appendChild(buildCard(update));

        }

    }

    filtersEl.addEventListener("click", function (event) {

        const button = event.target.closest(".updates-filter");

        if (!button) {
            return;
        }

        activeFilter = button.dataset.filter;
        renderFilters();
        renderList();

    });

    async function load() {

        try {

            const response = await fetch("/api/status-bubbles/history");

            if (!response.ok) {
                throw new Error("bad response");
            }

            const data = await response.json();

            allUpdates = Array.isArray(data)
                ? data.filter((u) => u && typeof u.message === "string" && Number.isFinite(Number(u.created_at)))
                : [];

            // Newest first, whatever order the server used.
            allUpdates.sort((a, b) => Number(b.id) - Number(a.id));

            renderFilters();
            renderList();

        } catch (err) {
            listEl.innerHTML = "";
            const message = document.createElement("p");
            message.className = "updates-empty";
            message.textContent = "Couldn't load updates right now. Please try again in a minute.";
            listEl.appendChild(message);
        }

    }

    load();

})();
