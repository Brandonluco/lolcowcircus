// This page is public-facing and loads no other script that already
// defines these, so (same convention as stock-charts.js) it keeps its own
// copies rather than depending on script.js being present.

function escapeForDisplay(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
}

// The API only ever stores a value it validated itself when it was set
// (see extractInstagramProfileUrl/extractInstagramReelUrl in worker.js),
// but this page builds real href attributes from whatever those
// endpoints return, so — same reasoning as script.js's copies of these —
// it re-checks the shape here too rather than trusting the response.

function getSafeInstagramProfileUrl(profileUrl) {

    if (typeof profileUrl !== "string" || !profileUrl) {
        return null;
    }

    let parsed;
    try {
        parsed = new URL(profileUrl);
    } catch {
        return null;
    }

    if (parsed.protocol !== "https:") {
        return null;
    }

    const host = parsed.hostname.toLowerCase();
    if (host !== "instagram.com" && host !== "www.instagram.com") {
        return null;
    }

    if (!/^\/[A-Za-z0-9_.]{1,30}\/?$/.test(parsed.pathname)) {
        return null;
    }

    return parsed.href;

}

function getSafeInstagramReelUrl(reelUrl) {

    if (typeof reelUrl !== "string") {
        return null;
    }

    let parsed;
    try {
        parsed = new URL(reelUrl);
    } catch {
        return null;
    }

    if (parsed.protocol !== "https:") {
        return null;
    }

    const host = parsed.hostname.toLowerCase();
    if (host !== "instagram.com" && host !== "www.instagram.com") {
        return null;
    }

    if (!/^\/(?:reel|reels|p)\/[A-Za-z0-9_-]+\/?$/.test(parsed.pathname)) {
        return null;
    }

    return parsed.href;

}

function formatFeaturedDate(ms) {

    if (!ms) {
        return "";
    }

    return new Date(ms).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
    });

}

// Wraps a name in a link to its Instagram profile when there's a valid
// one to link to, otherwise just the escaped plain name — shared by both
// the leaderboard and history rendering below.
function nameMarkup(name, profileUrl) {

    const safeProfileUrl = getSafeInstagramProfileUrl(profileUrl);

    if (safeProfileUrl) {
        return `<a href="${escapeForDisplay(safeProfileUrl)}" target="_blank" rel="noopener noreferrer">${escapeForDisplay(name)}</a>`;
    }

    return escapeForDisplay(name);

}

async function loadLeaderboard() {

    const container = document.getElementById("cow-leaderboard");

    try {

        const response = await fetch("/api/creator-of-the-week/leaderboard");

        if (!response.ok) {
            container.innerHTML = `<p class="cow-loading">Couldn't load the leaderboard right now.</p>`;
            return;
        }

        const rows = await response.json();

        if (rows.length === 0) {
            container.innerHTML = `<p class="cow-loading">No one's been featured yet.</p>`;
            return;
        }

        container.innerHTML = rows.map((row, index) => {

            const timesLabel = row.times_featured === 1 ? "1 time" : `${row.times_featured} times`;

            return `
                <div class="cow-leaderboard-row">
                    <div class="cow-rank">#${index + 1}</div>
                    <div class="cow-leaderboard-info">
                        <div class="cow-leaderboard-name">${nameMarkup(row.creator_name, row.profile_url)}</div>
                        <div class="cow-leaderboard-meta">Last featured ${escapeForDisplay(formatFeaturedDate(row.last_featured))}</div>
                    </div>
                    <div class="cow-leaderboard-count">${escapeForDisplay(timesLabel)}</div>
                </div>
            `;

        }).join("");

    } catch (err) {

        container.innerHTML = `<p class="cow-loading">Couldn't load the leaderboard right now.</p>`;
        console.log("Failed to load leaderboard:", err.message);

    }

}

async function loadHistory() {

    const container = document.getElementById("cow-history");

    try {

        const response = await fetch("/api/creator-of-the-week/history");

        if (!response.ok) {
            container.innerHTML = `<p class="cow-loading">Couldn't load the history right now.</p>`;
            return;
        }

        const rows = await response.json();

        if (rows.length === 0) {
            container.innerHTML = `<p class="cow-loading">No one's been featured yet.</p>`;
            return;
        }

        container.innerHTML = rows.map((row) => {

            const safeReelUrl = getSafeInstagramReelUrl(row.reel_url);
            const currentBadge = row.is_current ? `<span class="cow-history-current-badge">★ Currently featured</span>` : "";

            return `
                <div class="cow-history-row">
                    <div class="cow-history-name">
                        ${nameMarkup(row.creator_name, row.profile_url)}${currentBadge}
                    </div>
                    <div class="cow-history-right">
                        <div class="cow-history-date">${escapeForDisplay(formatFeaturedDate(row.featured_at))}</div>
                        ${safeReelUrl ? `<a class="cow-history-reel-link" href="${escapeForDisplay(safeReelUrl)}" target="_blank" rel="noopener noreferrer">View reel</a>` : ""}
                    </div>
                </div>
            `;

        }).join("");

    } catch (err) {

        container.innerHTML = `<p class="cow-loading">Couldn't load the history right now.</p>`;
        console.log("Failed to load history:", err.message);

    }

}

loadLeaderboard();
loadHistory();
