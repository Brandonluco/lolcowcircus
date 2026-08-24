async function loadStockGrid() {

    const grid = document.getElementById("stock-chart-grid");

    const response = await fetch("/api/stock-history");

    const rows = await response.json();

    const grouped = groupStockHistoryRows(rows);

    // Alphabetical rather than "most recently moved" here — this page is
    // the full reference list, not a highlights view, so it should be easy
    // to find one specific streamer rather than reshuffling every visit.
    grouped.sort((a, b) => (a.streamer.name || "").localeCompare(b.streamer.name || ""));

    if (grouped.length === 0) {
        grid.innerHTML = `<p class="stock-loading">No streamers yet.</p>`;
        return;
    }

    grid.innerHTML = grouped.map((entry) => {

        const chartSvg = buildSingleStockChartSvg(entry, {
            width: 260,
            height: 160,
            padding: 20
        });

        return `
            <div class="stock-chart-tile">
                <div class="stock-chart-tile-header">
                    <span class="stock-chart-tile-name">${escapeForDisplay(entry.streamer.name)}</span>
                    <span class="stock-chart-tile-ticker">${escapeForDisplay(tickerLabelFor(entry.streamer))}</span>
                </div>
                ${chartSvg}
            </div>
        `;

    }).join("");

}

loadStockGrid();
