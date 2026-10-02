// Fetched once, kept here, and re-rendered from on every range-button
// click — the API returns each streamer's entire history in one response,
// so switching a tile between 1M/3M/6M/1Y/All never needs a new request.
let groupedStockEntries = [];

// Which range each streamer's tile is currently showing, keyed by
// streamer_id — defaults to "1m" the first time a tile is rendered.
const selectedRangeByStreamer = new Map();

function currentValueFor(entry) {

    if (entry.events.length === 0) {
        return null;
    }

    let total = 0;
    for (const event of entry.events) {
        total += event.points;
    }

    return total;

}

function renderStockTile(entry) {

    const rangeKey = selectedRangeByStreamer.get(String(entry.streamer.id)) || "1m";

    const chartSvg = buildSingleStockChartSvg(entry, {
        width: 260,
        height: 160,
        padding: 20,
        rangeKey: rangeKey
    });

    const currentValue = currentValueFor(entry);

    const valueHtml = currentValue === null
        ? ""
        : `<span class="stock-chart-tile-value ${currentValue > 0 ? "stock-chart-tile-value-up" : (currentValue < 0 ? "stock-chart-tile-value-down" : "")}">${escapeForDisplay(formatStockValue(currentValue))}</span>`;

    const rangeButtonsHtml = Object.entries(STOCK_RANGES).map(([key, range]) => `
        <button
            type="button"
            class="stock-range-button ${key === rangeKey ? "stock-range-button-active" : ""}"
            data-streamer-id="${entry.streamer.id}"
            data-range="${key}"
        >${escapeForDisplay(range.label)}</button>
    `).join("");

    return `
        <div class="stock-chart-tile" data-streamer-id="${entry.streamer.id}">
            <div class="stock-chart-tile-header">
                <span class="stock-chart-tile-name">${escapeForDisplay(entry.streamer.name)}</span>
                <span class="stock-chart-tile-ticker">${escapeForDisplay(tickerLabelFor(entry.streamer))}</span>
            </div>
            <div class="stock-chart-tile-chart">${chartSvg}</div>
            <div class="stock-chart-tile-footer">
                <div class="stock-range-picker">${rangeButtonsHtml}</div>
                ${valueHtml}
            </div>
        </div>
    `;

}

function renderStockGrid() {

    const grid = document.getElementById("stock-chart-grid");

    grid.innerHTML = groupedStockEntries.map(renderStockTile).join("");

}

async function loadStockGrid() {

    const grid = document.getElementById("stock-chart-grid");

    const response = await fetch("/api/stock-history");

    const rows = await response.json();

    groupedStockEntries = groupStockHistoryRows(rows);

    // Alphabetical rather than "most recently moved" here — this page is
    // the full reference list, not a highlights view, so it should be easy
    // to find one specific streamer rather than reshuffling every visit.
    groupedStockEntries.sort((a, b) => (a.streamer.name || "").localeCompare(b.streamer.name || ""));

    if (groupedStockEntries.length === 0) {
        grid.innerHTML = `<p class="stock-loading">No streamers yet.</p>`;
        return;
    }

    renderStockGrid();

}

// One delegated listener for every tile's range buttons, rather than
// re-attaching listeners after every re-render — clicking a range button
// just swaps that one streamer's selected range and re-renders the whole
// grid from the already-fetched data (no new request).
document.addEventListener("click", function(event) {

    const button = event.target.closest(".stock-range-button");

    if (!button) {
        return;
    }

    selectedRangeByStreamer.set(button.dataset.streamerId, button.dataset.range);

    renderStockGrid();

});

loadStockGrid();
