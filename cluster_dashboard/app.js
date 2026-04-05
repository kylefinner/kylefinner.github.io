const DEFAULT_FOV_ARCMIN = 12;
const MASS_UNIT = 1e14;
const DEFAULT_DISPLAY_LIMIT = 2000;
const CORE_COLUMNS = [
  "name_best",
  "z_best",
  "mass_best",
  "dynamical_state",
  "n_catalogs",
  "ra_deg",
  "dec_deg",
  "name_best_src",
  "catalogs_present"
];
const SURVEYS = {
  "Pan-STARRS DR1 color": "P/PanSTARRS/DR1/color-i-r-g",
  "DSS2 color": "P/DSS2/color",
  "DESI Legacy Survey (DR10) color": "P/DESI-Legacy-Surveys/DR10/color",
  "2MASS color": "P/2MASS/color",
  "WISE color": "P/WISE/color",
  "Aladin default": null
};

const state = {
  rawRows: [],
  filteredRows: [],
  columns: [],
  catalogs: [],
  defaults: {
    zMin: 0,
    zMax: 2,
    massMin14: 0,
    massMax14: 15,
    nMax: 50
  },
  appliedFilters: null,
  appliedViewSettings: null,
  selectedMasterId: null,
  generatedAt: null
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  populateSurveyOptions();
  bindEvents();
  loadData().catch((error) => {
    console.error(error);
    setStatus("Could not load site data. Generate site/data/clusters.json.gz with python export_web_data.py.");
    renderEmpty();
  });
});

function cacheElements() {
  [
    "searchInput",
    "raInput",
    "decInput",
    "radiusInput",
    "zMinInput",
    "zMaxInput",
    "massMinInput",
    "massMaxInput",
    "nMinInput",
    "nMaxInput",
    "keepNaNsInput",
    "mustZInput",
    "mustMInput",
    "requiredCatalogs",
    "catalogCount",
    "sortBySelect",
    "sortOrderSelect",
    "tableColumnsSelect",
    "displayLimitInput",
    "applyViewBtn",
    "applyFiltersBtn",
    "resetFiltersBtn",
    "downloadCsvBtn",
    "clearSpatialBtn",
    "resetZBtn",
    "resetMassBtn",
    "surveySelect",
    "statusText",
    "tableSummary",
    "resultsTable",
    "detailsSummary",
    "alternateNames",
    "fieldsTable",
    "aladinContainer",
    "skyPlot",
    "massPlot"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  const filterInputIds = [
    "searchInput",
    "raInput",
    "decInput",
    "radiusInput",
    "zMinInput",
    "zMaxInput",
    "massMinInput",
    "massMaxInput",
    "nMinInput",
    "nMaxInput",
    "keepNaNsInput",
    "mustZInput",
    "mustMInput"
  ];
  const viewInputIds = ["sortBySelect", "sortOrderSelect", "tableColumnsSelect", "displayLimitInput"];

  viewInputIds.forEach((id) => {
    els[id].addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyViewSettings();
      }
    });
  });

  filterInputIds.forEach((id) => {
    els[id].addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyFilters();
      }
    });
  });

  els.requiredCatalogs.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyFilters();
    }
  });

  els.applyFiltersBtn.addEventListener("click", applyFilters);
  els.resetFiltersBtn.addEventListener("click", resetAllFilters);
  els.applyViewBtn.addEventListener("click", applyViewSettings);
  els.clearSpatialBtn.addEventListener("click", () => clearSpatialInputs(false));
  els.resetZBtn.addEventListener("click", () => resetZInputs(false));
  els.resetMassBtn.addEventListener("click", () => resetMassInputs(false));
  els.downloadCsvBtn.addEventListener("click", downloadFilteredCsv);
  els.surveySelect.addEventListener("change", () => renderDetails());

  els.resultsTable.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-master-id]");
    if (!row) {
      return;
    }
    state.selectedMasterId = Number(row.dataset.masterId);
    renderAll();
  });

  els.resultsTable.addEventListener("click", (event) => {
    const header = event.target.closest("th[data-column]");
    if (!header) {
      return;
    }
    const column = header.dataset.column;
    if (els.sortBySelect.value === column) {
      els.sortOrderSelect.value = els.sortOrderSelect.value === "Ascending" ? "Descending" : "Ascending";
    } else {
      els.sortBySelect.value = column;
      els.sortOrderSelect.value = column === "name_best" ? "Ascending" : "Descending";
    }
    applyViewSettings();
  });
}

async function loadData() {
  let payload;
  if (typeof DecompressionStream !== "undefined") {
    try {
      payload = await fetchJsonGzip("./data/clusters.json.gz");
    } catch (error) {
      console.warn("Falling back to plain JSON load.", error);
    }
  }
  if (!payload) {
    const response = await fetch("./data/clusters.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    payload = await response.json();
  }
  const rows = Array.isArray(payload) ? payload : payload.rows || [];

  state.rawRows = rows.map(prepareRow);
  state.columns = inferColumns(payload, state.rawRows);
  state.catalogs = inferCatalogs(payload, state.columns, state.rawRows);
  state.generatedAt = payload.generated_at || null;
  state.defaults = inferDefaults(payload, state.rawRows);
  state.selectedMasterId = state.rawRows[0]?.master_id ?? null;

  configureControls();
  renderCatalogChecklist();
  state.appliedFilters = getFiltersFromControls();
  state.appliedViewSettings = getViewSettingsFromControls();
  renderAll();
}

async function fetchJsonGzip(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`);
  }
  const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  return JSON.parse(text);
}

function prepareRow(row) {
  const prepared = { ...row };
  prepared.master_id = toNumber(row.master_id);
  prepared.z_best = toNumber(row.z_best);
  prepared.mass_best = toNumber(row.mass_best);
  prepared.n_catalogs = toNumber(row.n_catalogs);
  prepared.ra_deg = toNumber(row.ra_deg);
  prepared.dec_deg = toNumber(row.dec_deg);
  prepared.ra_wrapped = Number.isFinite(toNumber(row.ra_wrapped))
    ? toNumber(row.ra_wrapped)
    : wrapRa(prepared.ra_deg);
  prepared._ra_rad = Number.isFinite(prepared.ra_deg) ? degreesToRadians(prepared.ra_deg) : NaN;
  prepared._dec_rad = Number.isFinite(prepared.dec_deg) ? degreesToRadians(prepared.dec_deg) : NaN;
  prepared._sin_dec = Number.isFinite(prepared._dec_rad) ? Math.sin(prepared._dec_rad) : NaN;
  prepared._cos_dec = Number.isFinite(prepared._dec_rad) ? Math.cos(prepared._dec_rad) : NaN;
  prepared.alternate_names = getAlternateNames(row);
  prepared._catalog_set = getCatalogSet(row.catalogs_present);
  prepared._name_values = getNameValues(prepared);
  prepared._search_blob = row._search_blob || buildSearchBlob(prepared);
  prepared._search_compact = row._search_compact || compactName(prepared._search_blob);
  prepared._abell_numbers = extractAbellNumbers(prepared._name_values);
  return prepared;
}

function inferColumns(payload, rows) {
  const payloadColumns = Array.isArray(payload.columns) ? payload.columns : [];
  const sampleColumns = rows[0] ? Object.keys(rows[0]) : [];
  return unique([...payloadColumns, ...sampleColumns]).filter((column) => !column.startsWith("_"));
}

function inferCatalogs(payload, columns, rows) {
  if (Array.isArray(payload.catalogs)) {
    return payload.catalogs;
  }
  const fromColumns = columns
    .filter((column) => column.startsWith("name__"))
    .map((column) => column.replace(/^name__/, ""))
    .sort((a, b) => a.localeCompare(b));
  if (fromColumns.length) {
    return fromColumns;
  }
  return unique(rows.flatMap((row) => Array.from(row._catalog_set || [])))
    .sort((a, b) => a.localeCompare(b));
}

function inferDefaults(payload, rows) {
  const validMasses14 = rows
    .map((row) => row.mass_best)
    .filter(Number.isFinite)
    .map((value) => value / MASS_UNIT);
  const validNCatalogs = rows.map((row) => row.n_catalogs).filter(Number.isFinite);

  return {
    zMin: payload.defaults?.z_min ?? 0,
    zMax: payload.defaults?.z_max ?? 2,
    massMin14: payload.defaults?.mass_min_14 ?? minOr(validMasses14, 0),
    massMax14: payload.defaults?.mass_max_14 ?? maxOr(validMasses14, 15),
    nMax: payload.defaults?.n_catalogs_max ?? maxOr(validNCatalogs, 50)
  };
}

function configureControls() {
  resetZInputs(false);
  resetMassInputs(false);
  els.nMinInput.value = "0";
  els.nMaxInput.value = String(Math.max(50, Math.ceil(state.defaults.nMax)));
  els.radiusInput.value = "10";
  els.sortBySelect.value = "name_best";
  els.sortOrderSelect.value = "Ascending";
  els.tableColumnsSelect.value = "core";
  els.displayLimitInput.value = String(DEFAULT_DISPLAY_LIMIT);
  els.catalogCount.textContent = String(state.catalogs.length);
}

function populateSurveyOptions() {
  els.surveySelect.innerHTML = Object.keys(SURVEYS)
    .map((label) => `<option value="${escapeAttribute(label)}">${escapeHtml(label)}</option>`)
    .join("");
}

function renderCatalogChecklist() {
  if (state.catalogs.length === 0) {
    els.requiredCatalogs.innerHTML = `<p class="hint">No catalog list found in the dataset.</p>`;
    return;
  }

  els.requiredCatalogs.innerHTML = state.catalogs
    .map(
      (catalog) => `
        <label class="checkbox-item">
          <input type="checkbox" value="${escapeAttribute(catalog)}">
          <span>${escapeHtml(catalog)}</span>
        </label>
      `
    )
    .join("");
}

function renderAll() {
  state.filteredRows = getFilteredRows();
  ensureSelectedRow();

  setStatus(buildStatusText());

  renderPlots();
  renderTable();
  renderDetails();
}

function renderEmpty() {
  els.tableSummary.textContent = "No rows to show.";
  els.resultsTable.querySelector("thead").innerHTML = "";
  els.resultsTable.querySelector("tbody").innerHTML = `<tr><td class="empty-state">No data loaded yet.</td></tr>`;
  els.detailsSummary.innerHTML = `<div class="summary-card"><span class="summary-label">Selection</span><strong>No data</strong></div>`;
  els.alternateNames.innerHTML = `<span class="chip">Generate site/data/clusters.json.gz</span>`;
  els.fieldsTable.querySelector("tbody").innerHTML = "";
  els.aladinContainer.innerHTML = `<div class="aladin-empty">Generate site/data/clusters.json.gz to enable the viewer.</div>`;
  if (window.Plotly) {
    Plotly.purge(els.skyPlot);
    Plotly.purge(els.massPlot);
  }
}

function getFilteredRows() {
  const filters = state.appliedFilters || getFiltersFromControls();
  const query = filters.query;
  const spatialFilter = filters.spatialFilter;
  const zMin = filters.zMin;
  const zMax = filters.zMax;
  const massMin = filters.massMin;
  const massMax = filters.massMax;
  const nMin = filters.nMin;
  const nMax = filters.nMax;
  const keepNaNs = filters.keepNaNs;
  const mustZ = filters.mustZ;
  const mustM = filters.mustM;
  const requiredCatalogs = filters.requiredCatalogs;

  const filtered = state.rawRows.filter((row) => {
    if (!matchesSearch(row, query)) {
      return false;
    }
    if (!matchesSpatial(row, spatialFilter)) {
      return false;
    }
    if (!matchesScientificFilters(row, { zMin, zMax, massMin, massMax, nMin, nMax, keepNaNs, mustZ, mustM })) {
      return false;
    }
    if (!matchesRequiredCatalogs(row, requiredCatalogs)) {
      return false;
    }
    return true;
  });

  const viewSettings = state.appliedViewSettings || getViewSettingsFromControls();
  return filtered.sort(makeComparator(viewSettings.sortBy, viewSettings.sortOrder));
}

function getFiltersFromControls() {
  return {
    query: normalizeQuery(els.searchInput.value),
    spatialFilter: getSpatialFilter(),
    zMin: toNumber(els.zMinInput.value),
    zMax: toNumber(els.zMaxInput.value),
    massMin: toNumber(els.massMinInput.value) * MASS_UNIT,
    massMax: toNumber(els.massMaxInput.value) * MASS_UNIT,
    nMin: toNumber(els.nMinInput.value),
    nMax: toNumber(els.nMaxInput.value),
    keepNaNs: els.keepNaNsInput.checked,
    mustZ: els.mustZInput.checked,
    mustM: els.mustMInput.checked,
    requiredCatalogs: getCheckedCatalogs()
  };
}

function applyFilters() {
  state.appliedFilters = getFiltersFromControls();
  renderAll();
}

function getViewSettingsFromControls() {
  return {
    sortBy: els.sortBySelect.value,
    sortOrder: els.sortOrderSelect.value,
    tableColumns: els.tableColumnsSelect.value,
    displayLimit: sanitizeDisplayLimit(els.displayLimitInput.value)
  };
}

function applyViewSettings() {
  state.appliedViewSettings = getViewSettingsFromControls();
  renderAll();
}

function getSpatialFilter() {
  const raTarget = toNumber(els.raInput.value);
  const decTarget = toNumber(els.decInput.value);
  const radiusCandidate = toNumber(els.radiusInput.value);

  if (!Number.isFinite(raTarget) || !Number.isFinite(decTarget)) {
    return null;
  }

  const radiusArcmin = Number.isFinite(radiusCandidate) ? Math.max(radiusCandidate, 0) : 10;
  const raRad = degreesToRadians(raTarget);
  const decRad = degreesToRadians(decTarget);

  return {
    raTarget,
    decTarget,
    radiusArcmin,
    sinDec: Math.sin(decRad),
    cosDec: Math.cos(decRad),
    raRad,
    maxSepRad: degreesToRadians(radiusArcmin / 60)
  };
}

function matchesSearch(row, query) {
  if (!query) {
    return true;
  }
  const compactQuery = query.replace(/\s+/g, "");
  const abellMatch = compactQuery.match(/^(abell|a|aco)(\d{1,5})$/);
  if (abellMatch) {
    const queryNumber = String(Number(abellMatch[2]));
    return row._abell_numbers.includes(queryNumber) || row._search_compact.includes(compactQuery);
  }
  if (/^\d+$/.test(query)) {
    return new RegExp(`\\b${escapeRegExp(query)}\\b`).test(row._search_blob);
  }
  return row._search_blob.includes(query);
}

function matchesSpatial(row, spatialFilter) {
  if (!spatialFilter) {
    return true;
  }
  if (!Number.isFinite(row._ra_rad) || !Number.isFinite(row._dec_rad)) {
    return false;
  }
  const cosSep =
    row._sin_dec * spatialFilter.sinDec +
    row._cos_dec * spatialFilter.cosDec * Math.cos(row._ra_rad - spatialFilter.raRad);
  const sepRad = Math.acos(clamp(cosSep, -1, 1));
  return sepRad <= spatialFilter.maxSepRad;
}

function matchesScientificFilters(row, filters) {
  const { zMin, zMax, massMin, massMax, nMin, nMax, keepNaNs, mustZ, mustM } = filters;

  if (!matchesRange(row.z_best, zMin, zMax, keepNaNs, mustZ)) {
    return false;
  }
  if (!matchesRange(row.mass_best, massMin, massMax, keepNaNs, mustM)) {
    return false;
  }

  const nCatalogs = Number.isFinite(row.n_catalogs) ? row.n_catalogs : 0;
  return nCatalogs >= nMin && nCatalogs <= nMax;
}

function matchesRange(value, min, max, keepNaNs, mustExist) {
  const isValid = Number.isFinite(value);
  if (mustExist && !isValid) {
    return false;
  }
  if (!isValid) {
    return keepNaNs;
  }
  return value >= min && value <= max;
}

function matchesRequiredCatalogs(row, requiredCatalogs) {
  return requiredCatalogs.every((catalog) => row._catalog_set.has(catalog));
}

function makeComparator(sortBy, order) {
  const ascending = order === "Ascending";

  return (left, right) => {
    if (sortBy === "name_best" && ascending) {
      const [groupA, numberA] = abellGroupAndNumber(left.name_best);
      const [groupB, numberB] = abellGroupAndNumber(right.name_best);
      if (groupA !== groupB) {
        return groupA - groupB;
      }
      if (numberA !== numberB) {
        return numberA - numberB;
      }
    }

    const valueA = left[sortBy];
    const valueB = right[sortBy];
    const numericA = toNumber(valueA);
    const numericB = toNumber(valueB);

    if (Number.isFinite(numericA) || Number.isFinite(numericB)) {
      if (!Number.isFinite(numericA)) {
        return 1;
      }
      if (!Number.isFinite(numericB)) {
        return -1;
      }
      return ascending ? numericA - numericB : numericB - numericA;
    }

    const stringA = String(valueA ?? "");
    const stringB = String(valueB ?? "");
    return ascending ? stringA.localeCompare(stringB) : stringB.localeCompare(stringA);
  };
}

function renderPlots() {
  if (!window.Plotly) {
    return;
  }

  const selectedRow = getSelectedRow();
  const backgroundRows = sampleRows(state.rawRows, 15000);
  const displayRows = sampleRows(state.filteredRows, 5000);
  const allMassRows = sampleRows(getMassRows(state.rawRows), 9000);
  const filteredMassRows = ensureSelectedIncluded(sampleRows(getMassRows(state.filteredRows), 7000), selectedRow);

  Plotly.react(
    els.skyPlot,
    [
      {
        type: "scattergeo",
        mode: "markers",
        lat: backgroundRows.map((row) => row.dec_deg),
        lon: backgroundRows.map((row) => row.ra_wrapped),
        customdata: backgroundRows.map((row) => [row.name_best || "-", normalizeRaDegrees(row.ra_deg), row.dec_deg, row.master_id]),
        hovertemplate: "%{customdata[0]}<br>RA=%{customdata[1]:.4f}<br>Dec=%{customdata[2]:.4f}<br>master_id=%{customdata[3]}<extra></extra>",
        marker: { color: "#E5ECF6", size: 2 },
        name: "All"
      },
      {
        type: "scattergeo",
        mode: "markers",
        lat: displayRows.map((row) => row.dec_deg),
        lon: displayRows.map((row) => row.ra_wrapped),
        customdata: displayRows.map((row) => [row.name_best || "-", normalizeRaDegrees(row.ra_deg), row.dec_deg, row.master_id]),
        hovertemplate: "%{customdata[0]}<br>RA=%{customdata[1]:.4f}<br>Dec=%{customdata[2]:.4f}<br>master_id=%{customdata[3]}<extra></extra>",
        marker: { color: "#111111", size: 4, opacity: 0.6 },
        name: "Filtered"
      },
      ...(selectedRow && state.filteredRows.some((row) => row.master_id === selectedRow.master_id)
        ? [
            {
              type: "scattergeo",
              mode: "markers",
              lat: [selectedRow.dec_deg],
              lon: [selectedRow.ra_wrapped],
              customdata: [[selectedRow.name_best || "-", normalizeRaDegrees(selectedRow.ra_deg), selectedRow.dec_deg, selectedRow.master_id]],
              hovertemplate: "%{customdata[0]}<br>RA=%{customdata[1]:.4f}<br>Dec=%{customdata[2]:.4f}<br>master_id=%{customdata[3]}<extra></extra>",
              marker: {
                color: "red",
                size: 12,
                symbol: "circle",
                line: { color: "white", width: 2 }
              },
              name: "Selected"
            }
          ]
        : [])
    ],
    {
      height: 220,
      margin: { l: 0, r: 0, t: 0, b: 0 },
      showlegend: false,
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      geo: {
        projection: { type: "mollweide" },
        showland: false,
        showcoastlines: false,
        showframe: true,
        bgcolor: "white"
      }
    },
    { displayModeBar: false, responsive: true }
  );

  if (allMassRows.length === 0) {
    Plotly.react(
      els.massPlot,
      [],
      {
        height: 220,
        margin: { l: 0, r: 0, t: 0, b: 42 },
        annotations: [
          {
            text: "No clusters with both z and mass in the current filter.",
            showarrow: false,
            x: 0.5,
            y: 0.5,
            xref: "paper",
            yref: "paper",
            font: { size: 14, color: "#6e6657" }
          }
        ],
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)"
      },
      { displayModeBar: false, responsive: true }
    );
    return;
  }

  Plotly.react(
    els.massPlot,
    [
      {
        type: "scatter",
        mode: "markers",
        x: allMassRows.map((row) => row.z_best),
        y: allMassRows.map((row) => row.mass_best / MASS_UNIT),
        marker: { size: 6, color: "#b2b2b2", opacity: 0.4 },
        customdata: allMassRows.map((row) => row.master_id),
        hovertemplate: "All clusters<br>z=%{x:.4f}<br>M=%{y:.3g}e14 Msun<br>master_id=%{customdata}<extra></extra>",
        showlegend: false
      },
      {
        type: "scatter",
        mode: "markers",
        x: filteredMassRows.map((row) => row.z_best),
        y: filteredMassRows.map((row) => row.mass_best / MASS_UNIT),
        marker: {
          size: 9,
          color: "rgba(196, 107, 32, 0.85)",
          line: { color: "#7f3d0d", width: 1.2 }
        },
        customdata: filteredMassRows.map((row) => row.master_id),
        hovertemplate: "Filtered<br>z=%{x:.4f}<br>M=%{y:.3g}e14 Msun<br>master_id=%{customdata}<extra></extra>",
        showlegend: false
      },
      ...(selectedRow && Number.isFinite(selectedRow.z_best) && Number.isFinite(selectedRow.mass_best)
        ? [
            {
              type: "scatter",
              mode: "markers",
              x: [selectedRow.z_best],
              y: [selectedRow.mass_best / MASS_UNIT],
              marker: {
                size: 14,
                color: "red",
                symbol: "circle",
                line: { color: "white", width: 2 }
              },
              hovertemplate: "Selected<br>z=%{x:.4f}<br>M=%{y:.3g}e14 Msun<extra></extra>",
              showlegend: false
            }
          ]
        : [])
    ],
    {
      height: 220,
      margin: { l: 0, r: 0, t: 0, b: 42 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      xaxis: { title: "Redshift (z)" },
      yaxis: { title: "Mass (1e14 Msun)" }
    },
    { displayModeBar: false, responsive: true }
  );
}

function renderTable() {
  const headerRoot = els.resultsTable.querySelector("thead");
  const bodyRoot = els.resultsTable.querySelector("tbody");
  const rows = state.filteredRows.slice(0, getDisplayLimit());
  const columns = getTableColumns();

  if (rows.length === 0) {
    headerRoot.innerHTML = "";
    bodyRoot.innerHTML = `<tr><td class="empty-state">No clusters match the current filters.</td></tr>`;
    els.tableSummary.textContent = "Showing 0 rows.";
    return;
  }

  const headerHtml = columns
    .map((column) => {
      const stickyClass = column === "name_best" ? "sticky-name" : "";
      const viewSettings = state.appliedViewSettings || getViewSettingsFromControls();
      const activeSort = viewSettings.sortBy === column
        ? ` ${viewSettings.sortOrder === "Ascending" ? "↑" : "↓"}`
        : "";
      return `<th class="is-sortable ${stickyClass}" data-column="${escapeAttribute(column)}">${escapeHtml(column)}${activeSort}</th>`;
    })
    .join("");

  const bodyHtml = rows
    .map((row) => {
      const selectedClass = row.master_id === state.selectedMasterId ? "is-selected" : "";
      const cells = columns
        .map((column) => {
          const stickyClass = column === "name_best" ? "sticky-name" : "";
          return `<td class="${stickyClass}">${escapeHtml(formatValue(row[column], column))}</td>`;
        })
        .join("");
      return `<tr class="${selectedClass}" data-master-id="${escapeAttribute(row.master_id)}">${cells}</tr>`;
    })
    .join("");

  headerRoot.innerHTML = `<tr>${headerHtml}</tr>`;
  bodyRoot.innerHTML = bodyHtml;
  els.tableSummary.textContent = `Showing ${formatNumber(rows.length)} of ${formatNumber(state.filteredRows.length)} filtered rows.`;
}

function renderDetails() {
  const row = getSelectedRow();
  if (!row) {
    els.detailsSummary.innerHTML = `<div class="summary-card"><span class="summary-label">Selection</span><strong>No row selected</strong></div>`;
    els.alternateNames.innerHTML = "";
    els.fieldsTable.querySelector("tbody").innerHTML = "";
    els.aladinContainer.innerHTML = `<div class="aladin-empty">Select a row to load Aladin.</div>`;
    return;
  }

  els.detailsSummary.innerHTML = [
    summaryCard("Best Name", row.name_best || "-"),
    summaryCard("Redshift (z)", formatValue(row.z_best, "z_best")),
    summaryCard("Mass M500", Number.isFinite(row.mass_best) ? `${formatFloat(row.mass_best / MASS_UNIT, 4)} x 10^14 Msun` : "-"),
    summaryCard("Dyn State", row.dynamical_state || "-"),
    summaryCard("RA", formatValue(row.ra_deg, "ra_deg")),
    summaryCard("Dec", formatValue(row.dec_deg, "dec_deg"))
  ].join("");

  const altNames = Array.isArray(row.alternate_names) ? row.alternate_names : [];
  els.alternateNames.innerHTML = altNames.length
    ? altNames.map((name) => `<span class="chip">${escapeHtml(String(name))}</span>`).join("")
    : `<span class="chip">No alternate names</span>`;

  const fieldRows = state.columns
    .map((column) => `
      <tr>
        <td>${escapeHtml(column)}</td>
        <td>${escapeHtml(formatValue(row[column], column))}</td>
      </tr>
    `)
    .join("");
  els.fieldsTable.querySelector("tbody").innerHTML = fieldRows;

  renderAladin(row);
}

function renderAladin(row) {
  if (!Number.isFinite(row.ra_deg) || !Number.isFinite(row.dec_deg)) {
    els.aladinContainer.innerHTML = `<div class="aladin-empty">Selected row is missing RA/Dec; cannot render Aladin.</div>`;
    return;
  }

  if (!window.A || !window.A.init) {
    els.aladinContainer.innerHTML = `<div class="aladin-empty">Loading Aladin Lite...</div>`;
    return;
  }

  els.aladinContainer.innerHTML = `<div id="aladin-lite-view" style="width:100%;height:500px;"></div>`;

  const surveyLabel = els.surveySelect.value || "Aladin default";
  const surveyId = SURVEYS[surveyLabel];

  window.A.init.then(() => {
    const aladin = A.aladin("#aladin-lite-view", {
      target: `${row.ra_deg} ${row.dec_deg}`,
      fov: DEFAULT_FOV_ARCMIN / 60,
      survey: surveyId || undefined,
      showLayersControl: true,
      expandLayersControl: false,
      showGotoControl: true,
      showZoomControl: true,
      showFullscreenControl: true,
      showContextMenu: true,
      showShareControl: true
    });

    const catalog = A.catalog({ name: "Target", sourceSize: 18 });
    aladin.addCatalog(catalog);
    catalog.addSources([A.source(row.ra_deg, row.dec_deg, { name: row.name_best || "selected" })]);
  });
}

function getSelectedRow() {
  return state.rawRows.find((row) => row.master_id === state.selectedMasterId) || null;
}

function ensureSelectedRow() {
  if (state.filteredRows.length === 0) {
    state.selectedMasterId = null;
    return;
  }
  if (state.selectedMasterId !== null && state.filteredRows.some((row) => row.master_id === state.selectedMasterId)) {
    return;
  }
  state.selectedMasterId = state.filteredRows[0]?.master_id ?? null;
}

function getCheckedCatalogs() {
  return Array.from(els.requiredCatalogs.querySelectorAll("input[type='checkbox']:checked")).map((input) => input.value);
}

function getTableColumns() {
  const viewSettings = state.appliedViewSettings || getViewSettingsFromControls();
  if (viewSettings.tableColumns === "all") {
    return state.columns.filter((column) => column !== "master_id");
  }
  const core = CORE_COLUMNS.filter((column) => state.columns.includes(column));
  return unique(core);
}

function getDisplayLimit() {
  const viewSettings = state.appliedViewSettings || getViewSettingsFromControls();
  return sanitizeDisplayLimit(viewSettings.displayLimit);
}

function sanitizeDisplayLimit(value) {
  const limit = Math.trunc(toNumber(value));
  if (!Number.isFinite(limit) || limit < 1) {
    return DEFAULT_DISPLAY_LIMIT;
  }
  return Math.min(limit, 20000);
}

function resetZInputs(shouldRender = true) {
  els.zMinInput.value = formatFloat(state.defaults.zMin, 3);
  els.zMaxInput.value = formatFloat(state.defaults.zMax, 3);
  if (shouldRender) {
    applyFilters();
  }
}

function resetMassInputs(shouldRender = true) {
  els.massMinInput.value = formatFloat(state.defaults.massMin14, 2);
  els.massMaxInput.value = formatFloat(state.defaults.massMax14, 2);
  if (shouldRender) {
    applyFilters();
  }
}

function clearSpatialInputs(shouldRender = true) {
  els.raInput.value = "";
  els.decInput.value = "";
  els.radiusInput.value = "10";
  if (shouldRender) {
    applyFilters();
  }
}

function resetAllFilters() {
  els.searchInput.value = "";
  clearSpatialInputs(false);
  resetZInputs(false);
  resetMassInputs(false);
  els.nMinInput.value = "0";
  els.nMaxInput.value = String(Math.max(50, Math.ceil(state.defaults.nMax)));
  els.keepNaNsInput.checked = true;
  els.mustZInput.checked = false;
  els.mustMInput.checked = false;
  els.requiredCatalogs.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.checked = false;
  });
  applyFilters();
}

function downloadFilteredCsv() {
  const columns = state.columns;
  const lines = [
    columns.join(","),
    ...state.filteredRows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "filtered_clusters.csv";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function buildStatusText() {
  if (state.rawRows.length === 0) {
    return "Generate site/data/clusters.json.gz to load the dashboard.";
  }
  const appliedFilters = state.appliedFilters || getFiltersFromControls();
  const requiredCatalogs = appliedFilters.requiredCatalogs;
  const searchState = appliedFilters.query ? `searching for "${appliedFilters.query}"` : "showing the full catalog";
  const catalogState = requiredCatalogs.length ? ` requiring ${requiredCatalogs.join(", ")}` : "";
  return `Loaded ${formatNumber(state.rawRows.length)} clusters, ${searchState}, with ${formatNumber(state.filteredRows.length)} matches.${catalogState}`;
}

function setStatus(text) {
  if (els.statusText) {
    els.statusText.textContent = text;
  }
}

function buildSearchBlob(row) {
  return getNameValues(row)
    .map((value) => String(value).toLowerCase())
    .join(" | ");
}

function getNameValues(row) {
  const values = [];
  if (row.name_best !== null && row.name_best !== undefined && String(row.name_best).trim() !== "") {
    values.push(row.name_best);
  }
  getAlternateNames(row).forEach((name) => values.push(name));
  if (values.length) {
    return unique(values);
  }
  return Object.keys(row)
    .filter((column) => column === "name_best" || column.startsWith("name__"))
    .map((column) => row[column])
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== "");
}

function getAlternateNames(row) {
  if (Array.isArray(row.alternate_names)) {
    return row.alternate_names.filter((value) => value !== null && value !== undefined && String(value).trim() !== "");
  }
  if (typeof row.alternate_names === "string" && row.alternate_names.trim() !== "") {
    try {
      const parsed = JSON.parse(row.alternate_names);
      if (Array.isArray(parsed)) {
        return parsed.filter((value) => value !== null && value !== undefined && String(value).trim() !== "");
      }
    } catch (error) {
      return row.alternate_names.split("|").map((value) => value.trim()).filter(Boolean);
    }
  }
  return Object.keys(row)
    .filter((column) => column.startsWith("name__"))
    .map((column) => row[column])
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== "");
}

function getCatalogSet(value) {
  if (Array.isArray(value)) {
    return new Set(value.map((item) => String(item).trim()).filter(Boolean));
  }
  return new Set(
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function extractAbellNumbers(nameValues) {
  const numbers = [];
  nameValues.forEach((value) => {
    const match = String(value).trim().match(/^\s*(abell|aco|a)\s*[-_]?\s*0*(\d{1,5})\b/i);
    if (match) {
      numbers.push(String(Number(match[2])));
    }
  });
  return unique(numbers);
}

function normalizeQuery(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function compactName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s\-_()\[\]{},.;:|]/g, "");
}

function normalizeRaDegrees(value) {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) {
    return NaN;
  }
  return ((numeric % 360) + 360) % 360;
}

function abellGroupAndNumber(name) {
  if (typeof name !== "string") {
    return [1, 1e9];
  }
  const match = name.trim().match(/^\s*(abell|aco|a)\s*[-_]?\s*(\d{1,5})\b/i);
  if (!match) {
    return [1, 1e9];
  }
  return [0, Number(match[2])];
}

function angularSeparationArcmin(ra1Deg, dec1Deg, ra2Deg, dec2Deg) {
  const ra1 = degreesToRadians(ra1Deg);
  const dec1 = degreesToRadians(dec1Deg);
  const ra2 = degreesToRadians(ra2Deg);
  const dec2 = degreesToRadians(dec2Deg);
  const cosSep =
    Math.sin(dec1) * Math.sin(dec2) +
    Math.cos(dec1) * Math.cos(dec2) * Math.cos(ra1 - ra2);
  const sep = Math.acos(clamp(cosSep, -1, 1));
  return (sep * 180 / Math.PI) * 60;
}

function degreesToRadians(value) {
  return value * Math.PI / 180;
}

function getMassRows(rows) {
  return rows.filter((row) => Number.isFinite(row.z_best) && Number.isFinite(row.mass_best));
}

function ensureSelectedIncluded(rows, selectedRow) {
  if (!selectedRow) {
    return rows;
  }
  const selectedPresent = rows.some((row) => row.master_id === selectedRow.master_id);
  if (selectedPresent) {
    return rows;
  }
  if (Number.isFinite(selectedRow.z_best) && Number.isFinite(selectedRow.mass_best)) {
    return [...rows, selectedRow];
  }
  return rows;
}

function sampleRows(rows, maxCount) {
  if (rows.length <= maxCount) {
    return rows;
  }
  const step = rows.length / maxCount;
  const sampled = [];
  for (let index = 0; index < maxCount; index += 1) {
    sampled.push(rows[Math.floor(index * step)]);
  }
  return sampled;
}

function wrapRa(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return value > 180 ? value - 360 : value;
}

function toNumber(value) {
  if (value === null || value === undefined) {
    return NaN;
  }
  if (typeof value === "string" && value.trim() === "") {
    return NaN;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function formatValue(value, column) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (Array.isArray(value)) {
    return value.length ? value.join(", ") : "-";
  }
  if (["z_best", "ra_deg", "dec_deg"].includes(column) && Number.isFinite(toNumber(value))) {
    return formatFloat(value, 4);
  }
  if (column === "mass_best" && Number.isFinite(toNumber(value))) {
    return formatExponential(value, 3);
  }
  if (Number.isFinite(toNumber(value))) {
    return formatFloat(value, 3);
  }
  return String(value);
}

function formatFloat(value, digits) {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
}

function formatExponential(value, digits) {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return numeric.toExponential(digits);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString();
}

function minOr(values, fallback) {
  return values.length ? Math.min(...values) : fallback;
}

function maxOr(values, fallback) {
  return values.length ? Math.max(...values) : fallback;
}

function unique(values) {
  return [...new Set(values)];
}

function summaryCard(label, value) {
  return `
    <div class="summary-card">
      <span class="summary-label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </div>
  `;
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
