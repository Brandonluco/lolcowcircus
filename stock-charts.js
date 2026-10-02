// Shared by both the homepage "top movers" widget and the full stock.html
// page, so the actual charting logic only exists in one place. Neither
// caller needs to know how the line is drawn — they just hand this file a
// list of {points, changed_at} events per streamer and get back SVG.
//
// The underlying number is a running total, like a real stock price: it
// never resets, there's no cap, and each event is a small nudge (±0.02 for
// a routine good/bad day) or an occasional bigger custom adjustment (a very
// good stretch, getting banned from a platform, etc). Both pages fetch a
// streamer's ENTIRE history and decide client-side how much of it to show —
// the homepage widget always shows the last 30 days, the full page lets the
// visitor pick a range — rather than asking the server for a different
// slice each time.

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

// Range options for the full stock.html page's picker. "all" has no ms
// value — it means "from this streamer's very first logged adjustment,"
// which varies per streamer, so it's resolved separately rather than as a
// fixed duration like the others.
const STOCK_RANGES = {
    "1m": { label: "1M", ms: 30 * 24 * 60 * 60 * 1000, agoLabel: "30 days ago" },
    "3m": { label: "3M", ms: 91 * 24 * 60 * 60 * 1000, agoLabel: "3 months ago" },
    "6m": { label: "6M", ms: 182 * 24 * 60 * 60 * 1000, agoLabel: "6 months ago" },
    "1y": { label: "1Y", ms: 365 * 24 * 60 * 60 * 1000, agoLabel: "1 year ago" },
    "all": { label: "All", ms: null, agoLabel: "the beginning" }
};

const STOCK_WINDOW_MS = STOCK_RANGES["1m"].ms;

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

// "+2.34" / "-1.10" / "0.00" — a consistent signed format used everywhere
// a running total gets displayed, so it always reads like a price rather
// than a plain number.
function formatStockValue(value) {
    const rounded = Math.round(value * 100) / 100;
    const sign = rounded > 0 ? "+" : "";
    return `${sign}${rounded.toFixed(2)}`;
}

// Groups the flat rows the API returns (one row per streamer per logged
// adjustment, or one row with points/changed_at both null for a streamer
// with no history at all) into { streamer, events[] } per streamer, events
// sorted oldest-first — the shape every function below actually works with.
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

        if (row.points !== null && row.changed_at !== null) {
            byStreamer.get(row.streamer_id).events.push({
                points: row.points,
                changed_at: row.changed_at
            });
        }

    }

    for (const entry of byStreamer.values()) {
        entry.events.sort((a, b) => a.changed_at - b.changed_at);
    }

    return Array.from(byStreamer.values());

}

// The score never resets, so showing "the last 30 days" still needs to
// start its line at the right height — everything that happened before the
// window began, collapsed into one running total. events must be sorted
// oldest-first (groupStockHistoryRows already guarantees this).
function cumulativeBaseline(events, beforeTime) {

    let total = 0;

    for (const event of events) {
        if (event.changed_at < beforeTime) {
            total += event.points;
        } else {
            break;
        }
    }

    return total;

}

// Builds the actual series of (time, value) points to draw for one
// streamer within [windowStart, windowEnd]: a starting baseline point
// (everything before the window, collapsed), one point per event inside
// the window (each one step up or down from the last), and a final point
// holding that last value flat out to the right edge ("now").
function buildCumulativeSeries(events, windowStart, windowEnd) {

    const baseline = cumulativeBaseline(events, windowStart);

    const inWindow = events.filter(
        (event) => event.changed_at >= windowStart && event.changed_at <= windowEnd
    );

    const series = [{ time: windowStart, value: baseline }];

    let running = baseline;
    for (const event of inWindow) {
        running += event.points;
        series.push({ time: event.changed_at, value: running });
    }

    series.push({ time: windowEnd, value: running });

    return series;

}

// Turns a cumulative series into an SVG <polyline> points string, scaled
// to fit [padding, width/height - padding] — vertically auto-scaled to
// whatever range of values this particular streamer/window actually
// covers, since (unlike the old fixed up/down/neutral levels) there's no
// fixed ceiling or floor anymore. Drawn as ONE continuously-colored line
// (colored by the NET change across the whole window) rather than
// recoloring every tiny up/down step individually — with potentially
// hundreds of small ±0.02 events in a window, coloring each one separately
// would flicker between colors constantly and be unreadable; a real stock
// chart doesn't recolor itself every tick either; one line, one color,
// reflecting whether the overall period was good or bad.
function buildStepPath(series, windowStart, windowEnd, width, height, padding) {

    const values = series.map((p) => p.value);
    let minValue = Math.min(...values);
    let maxValue = Math.max(...values);

    if (minValue === maxValue) {
        // No movement at all in this window — give it artificial room so it
        // draws as a visible flat line rather than collapsing to one pixel row.
        minValue -= 0.5;
        maxValue += 0.5;
    } else {
        const range = maxValue - minValue;
        minValue -= range * 0.1;
        maxValue += range * 0.1;
    }

    const xFor = (t) => {
        const clamped = Math.max(windowStart, Math.min(windowEnd, t));
        const ratio = (clamped - windowStart) / (windowEnd - windowStart);
        return padding + ratio * (width - 2 * padding);
    };

    const yFor = (v) => {
        const ratio = (v - minValue) / (maxValue - minValue);
        return (height - padding) - ratio * (height - 2 * padding);
    };

    const coords = [];

    let x = xFor(series[0].time);
    let y = yFor(series[0].value);
    coords.push([x, y]);

    for (let i = 1; i < series.length; i++) {

        const point = series[i];
        const pointX = xFor(point.time);

        // Horizontal hold at the previous level up to this point's time...
        coords.push([pointX, y]);

        // ...then the vertical jump to the new level.
        const newY = yFor(point.value);
        if (newY !== y) {
            coords.push([pointX, newY]);
        }

        x = pointX;
        y = newY;

    }

    const startValue = series[0].value;
    const endValue = series[series.length - 1].value;
    const netChange = endValue - startValue;

    const color = netChange > 0.001
        ? STOCK_COLORS.up
        : (netChange < -0.001 ? STOCK_COLORS.down : STOCK_COLORS.neutral);

    return {
        pointsAttr: coords.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" "),
        color: color,
        startValue: startValue,
        endValue: endValue,
        minValue: minValue,
        maxValue: maxValue
    };

}

// Renders ONE streamer's chart as its own square-ish SVG — used by every
// tile on the full stock.html grid. rangeKey is one of STOCK_RANGES's keys
// ("1m"/"3m"/"6m"/"1y"/"all"); "all" starts the window at this streamer's
// very first logged event instead of a fixed duration back from now.
function buildSingleStockChartSvg(entry, options) {

    const width = options.width;
    const height = options.height;
    const padding = options.padding;
    const rangeKey = options.rangeKey || "1m";
    const range = STOCK_RANGES[rangeKey];

    const now = Date.now();

    if (entry.events.length === 0) {
        return `
            <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
                <line x1="${padding}" y1="${height / 2}" x2="${width - padding}" y2="${height / 2}" stroke="#dddddd" stroke-width="2" stroke-dasharray="4 4" />
                <text x="${width / 2}" y="${height / 2 - 10}" font-size="11" fill="#999999" text-anchor="middle">No stock activity yet</text>
            </svg>
        `;
    }

    const windowStart = range.ms === null ? entry.events[0].changed_at : now - range.ms;

    const series = buildCumulativeSeries(entry.events, windowStart, now);
    const path = buildStepPath(series, windowStart, now, width, height, padding);

    const axisLabels = `
        <text x="${padding}" y="${height - 4}" font-size="10" fill="#aaaaaa">${escapeForDisplay(range.agoLabel)}</text>
        <text x="${width - padding}" y="${height - 4}" font-size="10" fill="#aaaaaa" text-anchor="end">today</text>
    `;

    return `
        <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
            <polyline points="${path.pointsAttr}" fill="none" stroke="${path.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
            ${axisLabels}
        </svg>
    `;

}

// Renders the homepage widget: up to `limit` streamers overlaid on one
// square chart, picked by whoever logged an adjustment most recently, each
// as its own continuous line labeled with its ticker and current value at
// the point the line ends (the right edge). Always the last 30 days —
// no range picker here, that's full-stock-page-only.
function buildStockMoversSvg(groupedEntries, options) {

    const width = options.width;
    const height = options.height;
    const padding = options.padding;
    const limit = options.limit || 6;

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
                <text x="${width / 2}" y="${height / 2}" font-size="12" fill="#999999" text-anchor="middle">No stock activity in the last 30 days</text>
            </svg>
        `;
    }

    // Y-axis scale needs to fit every mover's series at once (unlike the
    // single-streamer chart above, which scales to just its own range), so
    // every line on this shared chart reads against the same baseline.
    const allSeries = movers.map((entry) => ({
        entry: entry,
        series: buildCumulativeSeries(entry.events, windowStart, now)
    }));

    const allValues = allSeries.flatMap((s) => s.series.map((p) => p.value));
    let minValue = Math.min(...allValues);
    let maxValue = Math.max(...allValues);

    if (minValue === maxValue) {
        minValue -= 0.5;
        maxValue += 0.5;
    } else {
        const range = maxValue - minValue;
        minValue -= range * 0.1;
        maxValue += range * 0.1;
    }

    const xFor = (t) => {
        const clamped = Math.max(windowStart, Math.min(now, t));
        const ratio = (clamped - windowStart) / (now - windowStart);
        return padding + ratio * (width - 2 * padding);
    };

    const yFor = (v) => {
        const ratio = (v - minValue) / (maxValue - minValue);
        return (height - padding) - ratio * (height - 2 * padding);
    };

    const linesSvg = [];
    const labelYPositions = [];

    allSeries.forEach(({ entry, series }) => {

        const coords = [];
        let x = xFor(series[0].time);
        let y = yFor(series[0].value);
        coords.push([x, y]);

        for (let i = 1; i < series.length; i++) {
            const point = series[i];
            const pointX = xFor(point.time);
            coords.push([pointX, y]);
            const newY = yFor(point.value);
            if (newY !== y) {
                coords.push([pointX, newY]);
            }
            x = pointX;
            y = newY;
        }

        const startValue = series[0].value;
        const endValue = series[series.length - 1].value;
        const netChange = endValue - startValue;
        const color = netChange > 0.001
            ? STOCK_COLORS.up
            : (netChange < -0.001 ? STOCK_COLORS.down : STOCK_COLORS.neutral);

        const pointsAttr = coords.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ");

        linesSvg.push(
            `<polyline points="${pointsAttr}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />`
        );

        // Nudge the label down slightly for each prior label already placed
        // within 11px of this one, so lines ending at a similar level don't
        // overlap each other's text.
        let labelY = y;
        while (labelYPositions.some((py) => Math.abs(py - labelY) < 11)) {
            labelY += 11;
        }
        labelYPositions.push(labelY);

        linesSvg.push(
            `<text x="${width - padding + 4}" y="${(labelY + 3).toFixed(1)}" font-size="10" font-weight="700" fill="${color}">${escapeForDisplay(tickerLabelFor(entry.streamer))} ${escapeForDisplay(formatStockValue(endValue))}</text>`
        );

    });

    return `
        <svg viewBox="0 0 ${width} ${height + 14}" xmlns="http://www.w3.org/2000/svg">
            ${linesSvg.join("")}
            <text x="${padding}" y="${height + 12}" font-size="10" fill="#aaaaaa">30 days ago</text>
            <text x="${width - padding}" y="${height + 12}" font-size="10" fill="#aaaaaa" text-anchor="end">today</text>
        </svg>
    `;

}
