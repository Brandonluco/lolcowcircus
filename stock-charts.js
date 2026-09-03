// Shared by both the homepage "top movers" widget and the full stock.html
// page, so the actual charting logic only exists in one place. Neither
// caller needs to know how a step line is drawn — they just hand this file
// a list of {trend, changed_at} events per streamer and get back SVG.

const STOCK_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// stock.html is public-facing and has no other script that already defines
// this (script.js has its own copy for index.html, this is stock.js's).
function escapeForDisplay(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
}

const STOCK_COLORS = {
    up: "#1e7e34",
    down: "#a32d2d",
    neutral: "#999999"
};

// Every streamer row comes back from the API with a ticker OR null (it's an
// optional field admins fill in later). Until a ticker is set, fall back to
// the first three letters of the name so a label always exists — this is
// only ever used for display, never stored back to the database.
function tickerLabelFor(streamer) {

    if (streamer.ticker) {
        return streamer.ticker;
    }

    const letters = (streamer.name || "").replace(/[^a-zA-Z]/g, "");

    return (letters.slice(0, 4) || "????").toUpperCase();

}

// Groups the flat rows the API returns (one row per streamer per history
// event, or one row with trend/changed_at both null for a streamer with no
// history in the window) into { streamer, events[] } per streamer, events
// sorted oldest-first.
function groupStockHistoryRows(rows) {

    const byStreamer = new Map();

    for (const row of rows) {

        if (!byStreamer.has(row.streamer_id)) {
            byStreamer.set(row.streamer_id, {
                streamer: {
                    id: row.streamer_id,
                    name: row.name,
                    ticker: row.ticker
                },
                events: []
            });
        }

        if (row.trend !== null && row.changed_at !== null) {
            byStreamer.get(row.streamer_id).events.push({
                trend: row.trend,
                changed_at: row.changed_at
            });
        }

    }

    for (const entry of byStreamer.values()) {
        entry.events.sort((a, b) => a.changed_at - b.changed_at);
    }

    return Array.from(byStreamer.values());

}

function yForTrend(trend, padding, height) {

    if (trend === "up") {
        return padding;
    }

    if (trend === "down") {
        return height - padding;
    }

    return height / 2;

}

// Builds the step path + colored segments for one streamer's events across
// the fixed time window [windowStart, windowEnd]. The line starts at the
// left edge already at the level of the earliest known event (we have no
// way of knowing what it was before that), and holds its last level flat
// out to the right edge ("now").
function buildStepSegments(events, windowStart, windowEnd, width, height, padding) {

    if (events.length === 0) {
        return [];
    }

    const xFor = (t) => {
        const clamped = Math.max(windowStart, Math.min(windowEnd, t));
        const ratio = (clamped - windowStart) / (windowEnd - windowStart);
        return padding + ratio * (width - 2 * padding);
    };

    const segments = [];

    let currentTrend = events[0].trend;
    let x = padding;
    let y = yForTrend(currentTrend, padding, height);

    for (const event of events) {

        const eventX = xFor(event.changed_at);

        // Horizontal hold at the current level up to this event's time.
        segments.push({
            x1: x, y1: y, x2: eventX, y2: y, trend: currentTrend
        });

        // Vertical jump to the new level at that same moment.
        const newY = yForTrend(event.trend, padding, height);
        segments.push({
            x1: eventX, y1: y, x2: eventX, y2: newY, trend: event.trend
        });

        x = eventX;
        y = newY;
        currentTrend = event.trend;

    }

    // Hold the final level out to the right edge ("today").
    segments.push({
        x1: x, y1: y, x2: width - padding, y2: y, trend: currentTrend
    });

    return segments;

}

function segmentsToSvgLines(segments) {

    return segments.map((seg) => {
        const color = STOCK_COLORS[seg.trend] || STOCK_COLORS.neutral;
        return `<line x1="${seg.x1.toFixed(1)}" y1="${seg.y1.toFixed(1)}" x2="${seg.x2.toFixed(1)}" y2="${seg.y2.toFixed(1)}" stroke="${color}" stroke-width="3" stroke-linecap="round" />`;
    }).join("");

}

// Renders ONE streamer's chart as its own small square SVG — used for every
// tile on the full stock.html grid, and reused internally by the combined
// homepage widget below.
function buildSingleStockChartSvg(entry, options) {

    const width = options.width;
    const height = options.height;
    const padding = options.padding;

    const now = Date.now();
    const windowStart = now - STOCK_WINDOW_MS;

    const segments = buildStepSegments(entry.events, windowStart, now, width, height, padding);

    const axisLabels = `
        <text x="${padding}" y="${height - 4}" font-size="10" fill="#aaaaaa">30d ago</text>
        <text x="${width - padding}" y="${height - 4}" font-size="10" fill="#aaaaaa" text-anchor="end">today</text>
    `;

    if (segments.length === 0) {
        return `
            <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
                <line x1="${padding}" y1="${height / 2}" x2="${width - padding}" y2="${height / 2}" stroke="#dddddd" stroke-width="2" stroke-dasharray="4 4" />
                <text x="${width / 2}" y="${height / 2 - 10}" font-size="11" fill="#999999" text-anchor="middle">No recent movement</text>
                ${axisLabels}
            </svg>
        `;
    }

    return `
        <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
            ${segmentsToSvgLines(segments)}
            ${axisLabels}
        </svg>
    `;

}

// Renders the homepage widget: up to `limit` streamers overlaid on one
// square chart, picked by whoever moved most recently, each line labeled
// with its ticker at the point the line ends (the right edge).
function buildStockMoversSvg(groupedEntries, options) {

    const width = options.width;
    const height = options.height;
    const padding = options.padding;
    const limit = options.limit || 7;

    const now = Date.now();
    const windowStart = now - STOCK_WINDOW_MS;

    const withHistory = groupedEntries.filter((entry) => entry.events.length > 0);

    withHistory.sort((a, b) => {
        const aLast = a.events[a.events.length - 1].changed_at;
        const bLast = b.events[b.events.length - 1].changed_at;
        return bLast - aLast;
    });

    const movers = withHistory.slice(0, limit);

    if (movers.length === 0) {
        return `
            <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
                <text x="${width / 2}" y="${height / 2}" font-size="12" fill="#999999" text-anchor="middle">No stock movement in the last 30 days</text>
            </svg>
        `;
    }

    const linesSvg = [];
    const labelYPositions = [];

    movers.forEach((entry) => {

        const segments = buildStepSegments(entry.events, windowStart, now, width, height, padding);
        linesSvg.push(segmentsToSvgLines(segments));

        const lastSegment = segments[segments.length - 1];
        let labelY = lastSegment.y2;

        // Nudge the label down slightly for each prior label already placed
        // within 10px of this one, so tickers ending at the same level
        // (e.g. two streamers both currently "up") don't overlap.
        while (labelYPositions.some((y) => Math.abs(y - labelY) < 11)) {
            labelY += 11;
        }
        labelYPositions.push(labelY);

        const color = STOCK_COLORS[entry.events[entry.events.length - 1].trend] || STOCK_COLORS.neutral;

        linesSvg.push(
            `<text x="${width - padding + 4}" y="${(labelY + 3).toFixed(1)}" font-size="10" font-weight="700" fill="${color}">${tickerLabelFor(entry.streamer)}</text>`
        );

    });

    return `
        <svg viewBox="0 0 ${width} ${height + 14}" xmlns="http://www.w3.org/2000/svg">
            ${linesSvg.join("")}
            <text x="${padding}" y="${height + 12}" font-size="10" fill="#aaaaaa">30d ago</text>
            <text x="${width - padding}" y="${height + 12}" font-size="10" fill="#aaaaaa" text-anchor="end">today</text>
        </svg>
    `;

}
