"use strict";

/* Cluster Explorer: front end for the master galaxy-cluster catalog.
   Data: data/clusters.json.gz (one row per cluster), data/members/ra_HH.json.gz
   (every catalog's entry, loaded on demand), data/catalogs.json (references). */

const DATA_URL = "./data/clusters.json.gz";
const META_URL = "./data/catalogs.json";
const DEFAULT_DISPLAY_LIMIT = 1000;

// Chart tokens. Categorical slots validated (dataviz validator, --pairs all, light
// surface #ffffff): blue / orange / aqua. Neutral grays carry "other" and context.
const INK = "#1d2129";
const INK_2 = "#4b515c";
const MUTED = "#7a808b";
const HAIR = "#eceef2";
const AXIS = "#cdd1d8";
const SURFACE = "#ffffff";
const SLOT = { blue: "#2a78d6", orange: "#eb6834", aqua: "#1baf7a" };
const OTHER = "#8a8f98";
const CONTEXT = "#d5d9e0";

const FAMILY_STYLE = {
  SZ: { color: SLOT.blue, shape: "circle", label: "SZ" },
  "X-ray": { color: SLOT.aqua, shape: "square", label: "X-ray" },
  optical: { color: SLOT.orange, shape: "rhomb", label: "Optical" },
  IR: { color: SLOT.orange, shape: "triangle", label: "IR" },
  radio: { color: "#6250d6", shape: "circle", label: "Diffuse radio" }
};
const RADIO_KINDS = [["halo", "Halo", "H"], ["relic", "Relic", "R"], ["minihalo", "Mini-halo", "MH"], ["phoenix", "Phoenix", "Ph"]];

function radioClass(row) {
  const h = row.radio_halo;
  const r = row.radio_relic;
  if (h && r) return "both";
  if (h) return "halo";
  if (r) return "relic";
  if (row.radio_minihalo || row.radio_phoenix) return "other";
  return "none";
}

const COLOR_MODES = {
  detection: {
    groups: [
      { key: "SZ", label: "SZ-detected", color: SLOT.blue },
      { key: "X-ray", label: "X-ray (no SZ)", color: SLOT.aqua },
      { key: "Optical/IR", label: "Optical / IR only", color: SLOT.orange }
    ],
    of: (row) => row.det_class || "Optical/IR"
  },
  mass: {
    groups: [
      { key: "SPT", label: "SPT mass", color: SLOT.blue },
      { key: "ACT", label: "ACT mass", color: SLOT.orange },
      { key: "X-ray", label: "X-ray mass", color: SLOT.aqua },
      { key: "Other", label: "Planck / other", color: OTHER },
      { key: "none", label: "No M500", color: CONTEXT }
    ],
    of: (row) => row._mgroup || "none"
  },
  radio: {
    groups: [
      { key: "both", label: "Halo + relic", color: SLOT.aqua },
      { key: "halo", label: "Radio halo", color: SLOT.blue },
      { key: "relic", label: "Radio relic", color: SLOT.orange },
      { key: "other", label: "Mini-halo / phoenix", color: OTHER },
      { key: "none", label: "None reported", color: CONTEXT }
    ],
    of: radioClass
  }
};

const MASS_SOURCES = {
  best: { col: "m500", err: "m500_err", src: "m500_src", label: "Adopted" },
  spt: { col: "m500_spt", err: "m500_spt_err", src: "m500_spt_src", label: "SPT", group: "SPT" },
  act: { col: "m500_act", err: "m500_act_err", src: "m500_act_src", label: "ACT", group: "ACT" },
  xray: { col: "m500_xray", err: "m500_xray_err", src: "m500_xray_src", label: "X-ray", group: "X-ray" },
  planck: { col: "m500_planck", err: "m500_planck_err", src: null, fixedSrc: "psz2", label: "Planck", group: "Other" }
};

// HiPS image surveys, loaded by URL straight from each provider (no ID resolution). Each has
// mirrors in order of preference; the first one that answers /properties is used.
// covers(): approximate footprint, used to pick the default image and the panels.
const CDS = "https://alasky.cds.unistra.fr";
const CDS2 = "https://alaskybis.cds.unistra.fr";
const EUCLID_Q1_FIELDS = [[269.73, 66.02, 2.8], [61.24, -48.42, 3.1], [52.93, -28.09, 2.1]];
const inLegacy = (r) => Math.abs(r.b) > 20 && r.dec > -65 && !(r.dec > 34 && r.b < 0);
const HIPS_SURVEYS = [
  { key: "ls_dr10", title: "DESI Legacy Surveys DR10", band: "g r i z", kind: "Optical", covers: inLegacy,
    urls: [`${CDS}/DESI-legacy-surveys/DR10/CDS_P_DESI-Legacy-Surveys_DR10_color`, `${CDS2}/DESI-legacy-surveys/DR10/CDS_P_DESI-Legacy-Surveys_DR10_color`] },
  { key: "ls_dr11", title: "DESI Legacy Surveys DR11", band: "g r i z", kind: "Optical", covers: inLegacy,
    urls: [`${CDS}/DESI-legacy-surveys/DR11/CDS_P_DESI-Legacy-Surveys_DR11_color`, `${CDS2}/DESI-legacy-surveys/DR11/CDS_P_DESI-Legacy-Surveys_DR11_color`] },
  { key: "ps1", title: "Pan-STARRS DR1", band: "g r i", kind: "Optical", covers: (r) => r.dec > -30,
    urls: [`${CDS}/Pan-STARRS/DR1/color-i-r-g`, `${CDS2}/Pan-STARRS/DR1/color-i-r-g`] },
  { key: "dss2", title: "DSS2", band: "colour", kind: "Optical", covers: () => true,
    urls: ["https://skies.esac.esa.int/DSSColor", `${CDS}/DSS/DSSColor`] },
  { key: "euclid_q1", title: "Euclid Q1", band: "VIS + NISP (azulero)", kind: "Optical/NIR",
    covers: (r) => EUCLID_Q1_FIELDS.some(([ra, dec, rad]) => angSepDeg(r.ra, r.dec, ra, dec) < rad),
    urls: [`${CDS}/Euclid/Q1/CDS_P_Euclid_Q1_color-azulero`, `${CDS2}/Euclid/Q1/CDS_P_Euclid_Q1_color-azulero`] },
  { key: "unwise", title: "unWISE", band: "W1 W2 (3.4, 4.6 µm)", kind: "IR", covers: () => true,
    urls: [`${CDS}/unWISE/color-W2-W1W2-W1`, `${CDS2}/unWISE/color-W2-W1W2-W1`] },
  { key: "erosita", title: "eROSITA-DE DR1", band: "0.2–2.3 keV", kind: "X-ray", cmap: "magma", covers: (r) => r.l >= 180,
    urls: ["https://erosita.mpe.mpg.de/erodat/static/hips/eRASS1_024_Rate_c010", `${CDS}/erosita/erosita_P_dr1_rate_024`] },
  { key: "lotss_dr3", title: "LOFAR LoTSS DR3", band: "144 MHz, 6″", kind: "Radio", cmap: "inferno", covers: (r) => r.dec > 0,
    urls: ["https://hips.astron.nl/ASTRON/P/lotss_dr3_high", `${CDS}/ASTRON/astron.nl_P_lotss_dr3_high`] },
  { key: "racs_mid", title: "ASKAP RACS-mid", band: "1.37 GHz", kind: "Radio", cmap: "inferno", covers: (r) => r.dec < 49,
    urls: ["https://casda.csiro.au/hips/RACS/mid/I", `${CDS}/CASDA/CSIRO_P_RACS_mid_I`] },
  { key: "nvss", title: "NVSS", band: "1.4 GHz, 45″", kind: "Radio", cmap: "inferno", covers: (r) => r.dec > -40,
    urls: [`${CDS}/NVSS/intensity`, `${CDS2}/NVSS/intensity`] }
];
const HIPS_BY_KEY = Object.fromEntries(HIPS_SURVEYS.map((h) => [h.key, h]));

// Static cutouts from the Legacy Surveys viewer (independent of CDS).
const CUTOUT_PANELS = [
  { key: "cut_ls_dr11", title: "DESI Legacy Surveys DR11", band: "g r i z", kind: "Optical", layer: "ls-dr11", covers: inLegacy },
  { key: "cut_vlass", title: "VLASS (epoch 1.2)", band: "3 GHz, 2.5″", kind: "Radio", layer: "vlass1.2", covers: (r) => r.dec > -40 }
];

// Aladin Lite is loaded only when needed (interactive view or panels), from npm via jsDelivr,
// so the page never waits on it and does not depend on the CDS web server.
const ALADIN_URL = "https://cdn.jsdelivr.net/npm/aladin-lite@3.8.2/dist/aladin.js";
let aladinLib = null;
function loadAladin(timeoutMs = 15000) {
  if (!aladinLib) {
    aladinLib = import(ALADIN_URL).then((mod) => {
      window.A = mod.default;
      return window.A.init.then(() => window.A);
    });
    aladinLib.catch(() => { aladinLib = null; });
  }
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs));
  return Promise.race([aladinLib, timeout]);
}

const hipsProbe = {};
// First mirror whose /properties answers OK. A definite HTTP error (e.g. 404) rules a mirror
// out; a network/TLS hiccup does not - such a mirror is still tried if nothing answered OK.
function resolveHips(survey) {
  if (!hipsProbe[survey.key]) {
    hipsProbe[survey.key] = (async () => {
      let maybe = null;
      for (const url of survey.urls) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 7000);
          try {
            const res = await fetch(`${url}/properties`, { signal: ctrl.signal, cache: "force-cache" });
            if (res.ok) return url;
            break; // HTTP error: this mirror is down
          } catch (error) {
            maybe = maybe || url;
          } finally {
            clearTimeout(timer);
          }
        }
      }
      return maybe;
    })();
  }
  return hipsProbe[survey.key];
}

let surveysProbed = false;
function probeAllSurveys() {
  if (surveysProbed) return;
  surveysProbed = true;
  HIPS_SURVEYS.forEach((h) => resolveHips(h).then((url) => {
    const opt = els.surveySelect.querySelector(`option[value="${h.key}"]`);
    if (opt && !url) {
      opt.disabled = true;
      opt.textContent = `${h.title} (unavailable right now)`;
    }
  }));
}

async function defaultSurvey(row) {
  for (const key of ["ls_dr10", "ls_dr11", "ps1", "dss2"]) {
    const h = HIPS_BY_KEY[key];
    if (h.covers(row) && await resolveHips(h)) return key;
  }
  for (const h of HIPS_SURVEYS) {
    if (await resolveHips(h)) return h.key;
  }
  return "dss2";
}

const state = {
  rows: [],
  byId: new Map(),
  filtered: [],
  meta: { catalogs: [] },
  catalogInfo: {},
  selectedId: null,
  sort: { key: "_m", dir: -1 },
  colorBy: "detection",
  massSource: "best",
  shards: {},
  aladin: null,
  aladinReady: null,
  viewMode: null, // null = automatic (static image inside the Legacy footprint), or "static" / "aladin"
  plotsBound: false,
  generatedAt: null
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  [
    "statusText", "filterForm", "searchInput", "posInput", "radiusInput", "posFeedback",
    "zMinInput", "zMaxInput", "zRequireSelect", "massSourceSelect", "massMinInput", "massMaxInput",
    "mustMassInput", "familyChecks", "nSurveysInput", "dynSelect", "hideConflictInput", "hidePairInput",
    "requiredCatalogs", "catalogCount", "resetFiltersBtn", "buildInfo", "catalogRefs", "pipelineLink",
    "statTiles", "colorBySelect", "legend", "skyPlot", "massPlot", "massPlotNote",
    "tableSummary", "displayLimitInput", "downloadCsvBtn", "downloadTargetsBtn", "resultsTable",
    "detailName", "detailAliases", "detailFlags", "detailCoords", "detailFacts", "massTable",
    "externalLinks", "surveySelect", "aladinLegend", "aladinContainer", "membersTable", "fieldsTable",
    "panelsBtn", "panelsWrap", "panelsGrid", "panelFovSelect",
    "viewStaticBtn", "viewAladinBtn", "staticLayerLabel", "staticLayerSelect", "surveyLabel", "staticView",
    "radioChecks", "radioCandInput"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
  els.surveySelect.innerHTML = HIPS_SURVEYS
    .map((h) => `<option value="${h.key}">${esc(h.title)} (${esc(h.band)})</option>`).join("");
  if (window.matchMedia("(max-width: 1000px)").matches) {
    document.getElementById("moreFilters").open = false; // phones: search first, other filters on demand
  }
  bindEvents();
  load().catch((error) => {
    console.error(error);
    setStatus("Could not load the catalog (data/clusters.json.gz).");
  });
});

/* ------------------------------------------------------------------ loading */

async function load() {
  const [payload, meta] = await Promise.all([
    fetchJsonGzip(DATA_URL),
    fetch(META_URL, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { catalogs: [] })).catch(() => ({ catalogs: [] }))
  ]);
  state.meta = meta;
  (meta.catalogs || []).forEach((c) => { state.catalogInfo[c.key] = c; });
  state.generatedAt = payload.generated_at;
  state.rows = (payload.rows || []).map(prepareRow);
  state.rows.forEach((row) => state.byId.set(row.id, row));
  state.columns = payload.columns || Object.keys(state.rows[0] || {});

  renderCatalogChecklist(payload.catalogs || []);
  renderAbout();
  setMassSource("best");

  const fromHash = findByName(decodeURIComponent(location.hash.replace(/^#/, "")));
  const params = new URLSearchParams(location.search);
  if (params.get("color") && COLOR_MODES[params.get("color")]) {
    state.colorBy = params.get("color");
    els.colorBySelect.value = state.colorBy;
  }
  (params.get("radio") || "").split(",").filter(Boolean).forEach((k) => {
    const box = els.radioChecks.querySelector(`input[value="${CSS.escape(k)}"]`);
    if (box) box.checked = true;
  });
  if (params.has("panels")) {
    els.panelsWrap.hidden = false;
    els.panelsBtn.setAttribute("aria-expanded", "true");
    els.panelsBtn.textContent = "Hide panels";
  }
  applyFilters();
  if (fromHash) {
    selectCluster(fromHash.id, { updateHash: false });
  } else if (state.filtered.length) {
    selectCluster(state.filtered[0].id, { updateHash: false });
  }
}

async function fetchJsonGzip(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}

function prepareRow(row) {
  row.ra_w = row.ra > 180 ? row.ra - 360 : row.ra;
  const [x, y] = mollweide(row.ra_w, row.dec);
  row._x = x;
  row._y = y;
  row._ra = row.ra * Math.PI / 180;
  row._sinDec = Math.sin(row.dec * Math.PI / 180);
  row._cosDec = Math.cos(row.dec * Math.PI / 180);
  row._cats = new Set(String(row.catalogs || "").split(",").filter(Boolean));
  row._fams = new Set(String(row.families || "").split("+").filter(Boolean));
  const names = [row.name, ...(row.alt_names || [])].filter(Boolean);
  row._search = names.join(" | ").toLowerCase();
  row._compact = compactName(row._search);
  row._abell = abellNumbers(names);
  return row;
}

function findByName(text) {
  const q = compactName(String(text || "").toLowerCase());
  if (!q) {
    return null;
  }
  return state.rows.find((row) => compactName(String(row.name).toLowerCase()) === q)
    || state.rows.find((row) => (row.alt_names || []).some((n) => compactName(n.toLowerCase()) === q))
    || null;
}

/* ------------------------------------------------------------------ events */

function bindEvents() {
  els.filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    applyFilters();
  });
  els.resetFiltersBtn.addEventListener("click", resetFilters);
  els.massSourceSelect.addEventListener("change", () => {
    setMassSource(els.massSourceSelect.value);
    applyFilters();
  });
  els.colorBySelect.addEventListener("change", () => {
    state.colorBy = els.colorBySelect.value;
    renderPlots();
    renderLegend();
  });
  els.displayLimitInput.addEventListener("change", renderTable);
  els.downloadCsvBtn.addEventListener("click", downloadCsv);
  els.downloadTargetsBtn.addEventListener("click", downloadTargets);
  els.surveySelect.addEventListener("change", () => {
    state.surveyChosen = true;
    setAladinSurvey();
  });
  els.panelsBtn.addEventListener("click", () => {
    const open = els.panelsWrap.hidden;
    els.panelsWrap.hidden = !open;
    els.panelsBtn.setAttribute("aria-expanded", String(open));
    els.panelsBtn.textContent = open ? "Hide panels" : "Multiwavelength panels";
    const row = state.byId.get(state.selectedId);
    if (open && row) renderPanels(row);
    if (!open) els.panelsGrid.innerHTML = "";
  });
  els.viewStaticBtn.addEventListener("click", () => setViewMode("static"));
  els.viewAladinBtn.addEventListener("click", () => setViewMode("aladin"));
  els.staticLayerSelect.addEventListener("change", () => {
    const row = state.byId.get(state.selectedId);
    if (row) renderStatic(row);
  });
  els.panelFovSelect.addEventListener("change", () => {
    const row = state.byId.get(state.selectedId);
    if (row && !els.panelsWrap.hidden) renderPanels(row);
  });
  els.panelsGrid.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-survey]");
    if (!btn) return;
    els.surveySelect.value = btn.dataset.survey;
    state.surveyChosen = true;
    state.viewMode = "aladin";
    const current = state.byId.get(state.selectedId);
    if (current) renderViewer(current);
    els.aladinContainer.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  els.posInput.addEventListener("input", () => {
    const pos = parseCoordinates(els.posInput.value);
    els.posFeedback.textContent = els.posInput.value.trim()
      ? (pos ? `RA ${pos.ra.toFixed(5)}°, Dec ${pos.dec.toFixed(5)}°` : "Could not read these coordinates.")
      : "";
  });

  els.resultsTable.addEventListener("click", (event) => {
    const header = event.target.closest("th[data-key]");
    if (header) {
      const key = header.dataset.key;
      state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : (key === "name" ? 1 : -1) };
      sortFiltered();
      renderTable();
      return;
    }
    const row = event.target.closest("tr[data-id]");
    if (row) {
      selectCluster(Number(row.dataset.id));
    }
  });
  els.resultsTable.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.matches("tr[data-id]")) {
      selectCluster(Number(event.target.dataset.id));
    }
  });
  document.addEventListener("click", (event) => {
    const copy = event.target.closest("[data-copy]");
    if (copy) {
      navigator.clipboard?.writeText(copy.dataset.copy).then(() => {
        const old = copy.textContent;
        copy.textContent = "Copied";
        setTimeout(() => { copy.textContent = old; }, 1200);
      });
    }
    const jump = event.target.closest("[data-select-id]");
    if (jump) {
      event.preventDefault();
      selectCluster(Number(jump.dataset.selectId));
    }
  });
  window.addEventListener("hashchange", () => {
    const row = findByName(decodeURIComponent(location.hash.replace(/^#/, "")));
    if (row && row.id !== state.selectedId) {
      selectCluster(row.id, { updateHash: false });
    }
  });
}

function setMassSource(key) {
  state.massSource = key;
  const src = MASS_SOURCES[key];
  for (const row of state.rows) {
    row._m = num(row[src.col]);
    row._me = num(row[src.err]);
    row._ms = src.src ? row[src.src] : (Number.isFinite(row._m) ? src.fixedSrc : undefined);
    row._mgroup = Number.isFinite(row._m) ? (src.group || row.mass_group) : undefined;
  }
  els.massPlotNote.innerHTML = key === "best"
    ? "Adopted M<sub>500c</sub> (as published, not rescaled); clusters with both z and mass."
    : `M<sub>500c</sub> from ${esc(src.label)} only (as published); clusters with both z and that mass.`;
}

/* ------------------------------------------------------------------ filtering */

function getFilters() {
  const families = Array.from(els.familyChecks.querySelectorAll("input:checked")).map((i) => i.value);
  const catalogs = Array.from(els.requiredCatalogs.querySelectorAll("input:checked")).map((i) => i.value);
  const pos = parseCoordinates(els.posInput.value);
  const radius = Math.max(num(els.radiusInput.value) || 10, 0);
  return {
    query: els.searchInput.value.trim().toLowerCase().replace(/\s+/g, " "),
    pos: pos ? { ...pos, cosR: Math.cos((radius / 60) * Math.PI / 180), radius } : null,
    zMin: num(els.zMinInput.value),
    zMax: num(els.zMaxInput.value),
    zRequire: els.zRequireSelect.value,
    mMin: num(els.massMinInput.value),
    mMax: num(els.massMaxInput.value),
    mustMass: els.mustMassInput.checked,
    families,
    nSurveys: num(els.nSurveysInput.value) || 1,
    dyn: els.dynSelect.value,
    hideConflict: els.hideConflictInput.checked,
    hidePair: els.hidePairInput.checked,
    radioKinds: Array.from(els.radioChecks.querySelectorAll("input:checked")).map((i) => i.value),
    radioCand: els.radioCandInput.checked,
    catalogs
  };
}

function applyFilters() {
  const f = getFilters();
  if (f.pos) {
    f.pos.ra_r = f.pos.ra * Math.PI / 180;
    f.pos.sinD = Math.sin(f.pos.dec * Math.PI / 180);
    f.pos.cosD = Math.cos(f.pos.dec * Math.PI / 180);
  }
  state.filtered = state.rows.filter((row) => passes(row, f));
  state.lastFilters = f;
  sortFiltered();
  renderAll();
}

function passes(row, f) {
  if (f.query && !matchesName(row, f.query)) return false;
  if (f.pos) {
    const cosSep = row._sinDec * f.pos.sinD + row._cosDec * f.pos.cosD * Math.cos(row._ra - f.pos.ra_r);
    if (cosSep < f.pos.cosR) return false;
  }
  const z = row.z;
  const hasZ = Number.isFinite(z);
  if (f.zRequire === "has" && !hasZ) return false;
  if (f.zRequire === "spec" && row.z_type !== "spec") return false;
  const zRange = Number.isFinite(f.zMin) || Number.isFinite(f.zMax);
  if (zRange && (!hasZ || (Number.isFinite(f.zMin) && z < f.zMin) || (Number.isFinite(f.zMax) && z > f.zMax))) return false;
  const m = row._m;
  const hasM = Number.isFinite(m);
  if (f.mustMass && !hasM) return false;
  if (hasM && ((Number.isFinite(f.mMin) && m < f.mMin) || (Number.isFinite(f.mMax) && m > f.mMax))) return false;
  if (!hasM && (Number.isFinite(f.mMin) || Number.isFinite(f.mMax))) return false;
  for (const fam of f.families) {
    if (!row._fams.has(fam)) return false;
  }
  if ((row.n_surveys || 0) < f.nSurveys) return false;
  if (f.dyn !== "any" && row.dyn_state !== f.dyn) return false;
  if (f.hideConflict && row.z_conflict) return false;
  if (f.hidePair && row.close_pair) return false;
  if (f.radioKinds.length && !f.radioKinds.some((k) => {
    const v = row[`radio_${k}`];
    return v === "confirmed" || (f.radioCand && v === "candidate");
  })) return false;
  for (const cat of f.catalogs) {
    if (!row._cats.has(cat)) return false;
  }
  return true;
}

function matchesName(row, query) {
  const compact = compactName(query);
  const abell = compact.match(/^(abell|aco|a)(s?)(\d{1,5})$/);
  if (abell) {
    const key = (abell[2] ? "S" : "") + String(Number(abell[3]));
    return row._abell.includes(key) || row._compact.includes(compact);
  }
  return row._search.includes(query) || (compact.length >= 4 && row._compact.includes(compact));
}

function resetFilters() {
  els.filterForm.reset();
  els.radiusInput.value = "10";
  els.nSurveysInput.value = "1";
  els.posFeedback.textContent = "";
  setMassSource("best");
  applyFilters();
}

function sortFiltered() {
  const { key, dir } = state.sort;
  const col = TABLE_COLUMNS.find((c) => c.key === key) || TABLE_COLUMNS[0];
  const get = col.sortValue || ((row) => row[key]);
  state.filtered.sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    const na = typeof va === "number" && Number.isFinite(va);
    const nb = typeof vb === "number" && Number.isFinite(vb);
    if (na || nb) {
      if (!na) return 1;
      if (!nb) return -1;
      return dir * (va - vb);
    }
    if (va == null || va === "") return 1;
    if (vb == null || vb === "") return -1;
    return dir * String(va).localeCompare(String(vb), undefined, { numeric: true });
  });
}

/* ------------------------------------------------------------------ render */

function renderAll() {
  setStatus(statusText());
  renderStats();
  renderLegend();
  renderPlots();
  renderTable();
}

function statusText() {
  const n = state.filtered.length;
  const f = state.lastFilters || {};
  const parts = [];
  if (f.query) parts.push(`name “${f.query}”`);
  if (f.pos) parts.push(`within ${f.pos.radius}′ of ${f.pos.ra.toFixed(3)}°, ${f.pos.dec.toFixed(3)}°`);
  return `${fmtInt(n)} of ${fmtInt(state.rows.length)} clusters${parts.length ? " · " + parts.join(" · ") : ""}`;
}

function renderStats() {
  const rows = state.filtered;
  let spec = 0;
  let mass = 0;
  let sz = 0;
  for (const r of rows) {
    if (r.z_type === "spec") spec += 1;
    if (Number.isFinite(r._m)) mass += 1;
    if (r._fams.has("SZ")) sz += 1;
  }
  const tile = (label, value) => `<div class="stat"><span class="stat-label">${esc(label)}</span><span class="stat-value">${fmtInt(value)}</span></div>`;
  els.statTiles.innerHTML = [
    tile("Clusters shown", rows.length),
    tile("Spectroscopic z", spec),
    tile(`With M500 (${MASS_SOURCES[state.massSource].label.toLowerCase()})`, mass),
    tile("SZ-detected", sz),
    tile("Radio halo / relic", rows.reduce((n, r) => n + (r.radio_halo || r.radio_relic ? 1 : 0), 0))
  ].join("");
}

function groupsFor(rows) {
  const mode = COLOR_MODES[state.colorBy];
  const out = mode.groups.map((g) => ({ ...g, rows: [] }));
  const index = Object.fromEntries(out.map((g, i) => [g.key, i]));
  for (const row of rows) {
    const k = mode.of(row);
    out[index[k] ?? out.length - 1].rows.push(row);
  }
  return out;
}

function renderLegend() {
  const groups = groupsFor(state.filtered);
  els.legend.innerHTML = groups
    .filter((g) => g.rows.length || g.key !== "none")
    .map((g) => `<span class="legend-item"><span class="legend-dot" style="background:${g.color}"></span>${esc(g.label)} <span class="legend-count">${fmtInt(g.rows.length)}</span></span>`)
    .join("");
}

/* ---------- plots */

function plotFont() {
  return { family: "Poppins, system-ui, sans-serif", size: 11, color: INK_2 };
}

function hoverLabel() {
  return { bgcolor: "#ffffff", bordercolor: AXIS, font: { family: "Poppins, system-ui, sans-serif", size: 12, color: INK } };
}

function sample(rows, max) {
  if (rows.length <= max) return rows;
  const step = rows.length / max;
  const out = [];
  for (let i = 0; i < max; i += 1) out.push(rows[Math.floor(i * step)]);
  return out;
}

function renderPlots() {
  if (!window.Plotly) {
    setTimeout(renderPlots, 300);
    return;
  }
  renderSky();
  renderMassZ();
  if (!state.plotsBound) {
    [els.skyPlot, els.massPlot].forEach((el) => {
      el.on("plotly_click", (event) => {
        const p = event.points && event.points[0];
        const id = p && (Array.isArray(p.customdata) ? p.customdata[0] : p.customdata);
        if (Number.isFinite(id)) selectCluster(id);
      });
    });
    state.plotsBound = true;
  }
}

function renderSky() {
  const isFiltered = state.filtered.length < state.rows.length;
  const traces = [...skyFrameTraces()];
  if (isFiltered) {
    const bg = sample(state.rows, 30000);
    traces.push({
      type: "scattergl", mode: "markers", x: bg.map((r) => r._x), y: bg.map((r) => r._y),
      marker: { size: 3, color: CONTEXT, opacity: 0.55 }, hoverinfo: "skip", showlegend: false
    });
  }
  for (const g of [...groupsFor(state.filtered)].reverse()) {
    if (!g.rows.length) continue;
    const dense = g.rows.length > 5000;
    traces.push({
      type: "scattergl", mode: "markers", name: g.label,
      x: g.rows.map((r) => r._x), y: g.rows.map((r) => r._y),
      customdata: g.rows.map((r) => [r.id, r.ra, r.dec, fmtZ(r)]),
      text: g.rows.map((r) => r.name),
      hovertemplate: "<b>%{text}</b><br>RA %{customdata[1]:.4f}°, Dec %{customdata[2]:.4f}°<br>%{customdata[3]}<extra></extra>",
      marker: { size: g.rows.length > 50000 ? 2.5 : (dense ? 3.5 : 7), color: g.color, opacity: g.rows.length > 50000 ? 0.35 : (dense ? 0.75 : 0.9), line: { color: SURFACE, width: dense ? 0 : 1 } },
      showlegend: false
    });
  }
  traces.push(selectionTrace(...selectionXY("sky")));
  Plotly.react(els.skyPlot, traces, {
    height: 320,
    margin: { l: 34, r: 8, t: 8, b: 8 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: plotFont(),
    hovermode: "closest",
    hoverdistance: 12,
    hoverlabel: hoverLabel(),
    dragmode: "pan",
    xaxis: { visible: false, range: [-2.95, 2.95], fixedrange: false },
    yaxis: { visible: false, range: [-1.5, 1.5], scaleanchor: "x", scaleratio: 1 },
    annotations: skyLabels()
  }, { displayModeBar: false, responsive: true, scrollZoom: true });
}

let SKY_FRAME = null;
function skyFrameTraces() {
  if (SKY_FRAME) return SKY_FRAME;
  const grid = { x: [], y: [] };
  for (let lon = -150; lon <= 150; lon += 30) {
    for (let lat = -90; lat <= 90; lat += 2) pushXY(grid, mollweide(lon, lat));
    grid.x.push(null); grid.y.push(null);
  }
  for (const lat of [-60, -30, 0, 30, 60]) {
    for (let lon = -180; lon <= 180; lon += 2) pushXY(grid, mollweide(lon, lat));
    grid.x.push(null); grid.y.push(null);
  }
  const edge = { x: [], y: [] };
  for (let lat = -90; lat <= 90; lat += 1) pushXY(edge, mollweide(179.999, lat));
  for (let lat = 90; lat >= -90; lat -= 1) pushXY(edge, mollweide(-179.999, lat));
  const gp = { x: [], y: [] };
  let last = null;
  for (let l = 0; l <= 360; l += 0.5) {
    const [ra, dec] = galacticToEquatorial(l, 0);
    const xy = mollweide(ra > 180 ? ra - 360 : ra, dec);
    if (last && Math.abs(xy[0] - last[0]) > 1) { gp.x.push(null); gp.y.push(null); }
    pushXY(gp, xy);
    last = xy;
  }
  SKY_FRAME = [
    { type: "scatter", mode: "lines", x: grid.x, y: grid.y, line: { color: HAIR, width: 1 }, hoverinfo: "skip", showlegend: false },
    { type: "scatter", mode: "lines", x: edge.x, y: edge.y, line: { color: AXIS, width: 1 }, hoverinfo: "skip", showlegend: false },
    { type: "scatter", mode: "lines", x: gp.x, y: gp.y, line: { color: "#a7adb7", width: 1.5 }, hoverinfo: "skip", showlegend: false }
  ];
  return SKY_FRAME;
}

function skyLabels() {
  const notes = [];
  for (let ra = 0; ra < 360; ra += 60) {
    const w = ra > 180 ? ra - 360 : ra;
    if (Math.abs(w) === 180) continue;
    const [x, y] = mollweide(w, 0);
    notes.push({ x, y, text: `${ra / 15}h`, showarrow: false, yshift: -9, font: { size: 10, color: INK_2 }, bgcolor: "rgba(255,255,255,0.8)" });
  }
  for (const dec of [-60, -30, 30, 60]) {
    const [x, y] = mollweide(179.999, dec);
    notes.push({ x, y, text: `${dec > 0 ? "+" : ""}${dec}°`, showarrow: false, xanchor: "right", xshift: -4, font: { size: 10, color: MUTED } });
  }
  const [gx, gy] = mollweide(...wrapRaDec(galacticToEquatorial(60, 0)));
  notes.push({ x: gx, y: gy, text: "Galactic plane", showarrow: false, xanchor: "left", xshift: 6, font: { size: 10, color: INK_2 }, bgcolor: "rgba(255,255,255,0.8)" });
  return notes;
}

function renderMassZ() {
  const isFiltered = state.filtered.length < state.rows.length;
  const withMass = (rows) => rows.filter((r) => Number.isFinite(r.z) && Number.isFinite(r._m) && r._m > 0);
  const traces = [];
  if (isFiltered) {
    const bg = sample(withMass(state.rows), 30000);
    traces.push({
      type: "scattergl", mode: "markers", x: bg.map((r) => r.z), y: bg.map((r) => r._m),
      marker: { size: 4, color: CONTEXT, opacity: 0.6 }, hoverinfo: "skip", showlegend: false
    });
  }
  const shown = withMass(state.filtered);
  for (const g of [...groupsFor(shown)].reverse()) {
    if (!g.rows.length) continue;
    const dense = g.rows.length > 3000; // translucent so overlap shows density
    traces.push({
      type: "scattergl", mode: "markers", name: g.label,
      x: g.rows.map((r) => r.z), y: g.rows.map((r) => r._m),
      customdata: g.rows.map((r) => [r.id, catLabel(r._ms), r.z_type || "z type unknown", fmtErr(r._me)]),
      text: g.rows.map((r) => r.name),
      hovertemplate: "<b>M500 %{y:.2f}%{customdata[3]} ×10¹⁴ M☉</b> · z %{x:.3f}<br>%{text}<br>mass: %{customdata[1]} · z: %{customdata[2]}<extra></extra>",
      // dense groups: solid markers without the surface ring (a 1px ring on a 5px dot reads as white)
      marker: { size: dense ? 4 : 8, color: g.color, opacity: dense ? 0.35 : 0.95, line: { color: SURFACE, width: dense ? 0 : 1 } },
      showlegend: false
    });
  }
  traces.push(selectionTrace(...selectionXY("mass")));
  const axis = { gridcolor: HAIR, linecolor: AXIS, zeroline: false, tickfont: { size: 10, color: MUTED }, ticks: "outside", tickcolor: AXIS };
  Plotly.react(els.massPlot, traces, {
    height: 320,
    margin: { l: 56, r: 12, t: 8, b: 44 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: plotFont(),
    hovermode: "closest",
    hoverdistance: 12,
    hoverlabel: hoverLabel(),
    xaxis: { ...axis, title: { text: "Redshift z", font: { size: 11, color: INK_2 } }, rangemode: "tozero" },
    yaxis: {
      ...axis, type: "log", title: { text: "M<sub>500c</sub> (10<sup>14</sup> M<sub>☉</sub>)", font: { size: 11, color: INK_2 } },
      tickvals: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20], ticktext: ["0.1", "0.2", "0.5", "1", "2", "5", "10", "20"]
    }
  }, { displayModeBar: false, responsive: true });
}

function selectionXY(which) {
  const sel = state.byId.get(state.selectedId);
  if (!sel) return [[], []];
  if (which === "sky") return [[sel._x], [sel._y]];
  return Number.isFinite(sel.z) && Number.isFinite(sel._m) && sel._m > 0 ? [[sel.z], [sel._m]] : [[], []];
}

function selectionTrace(x, y) {
  return {
    type: "scatter", mode: "markers", x, y, hoverinfo: "skip", showlegend: false, name: "selected",
    marker: { size: 18, color: "rgba(0,0,0,0)", line: { color: INK, width: 2.5 } }
  };
}

function updateSelectionTraces() {
  if (!window.Plotly) return;
  [[els.skyPlot, "sky"], [els.massPlot, "mass"]].forEach(([el, which]) => {
    if (!el.data || !el.data.length) return;
    const [x, y] = selectionXY(which);
    Plotly.restyle(el, { x: [x], y: [y] }, [el.data.length - 1]);
  });
}

/* ---------- table */

const TABLE_COLUMNS = [
  { key: "name", label: "Name", sticky: true, cell: (r) => esc(r.name) },
  { key: "ra", label: "RA", unit: "deg", num: true, cell: (r) => fix(r.ra, 4) },
  { key: "dec", label: "Dec", unit: "deg", num: true, cell: (r) => fix(r.dec, 4) },
  { key: "z", label: "z", num: true, cell: (r) => zCell(r) },
  { key: "_m", label: "M500", unit: "10¹⁴ M☉", num: true, cell: (r) => (Number.isFinite(r._m) ? fix(r._m, 2) : "–") },
  { key: "_ms", label: "Mass from", cell: (r) => (r._ms ? `<span title="${esc(catLabel(r._ms))}">${esc(state.catalogInfo[r._ms]?.survey || r._ms)}</span>` : "–") },
  { key: "sz_snr", label: "SZ S/N", num: true, cell: (r) => fix(r.sz_snr, 1) },
  { key: "families", label: "Detected", cell: (r) => famBadges(r) },
  { key: "radio_summary", label: "Radio", title: "Diffuse radio emission (H halo, R relic, MH mini-halo, Ph phoenix; ? = candidate)",
    sortValue: (r) => ({ both: 4, halo: 3, relic: 2, other: 1 })[radioClass(r)] || 0, cell: (r) => radioBadges(r) },
  { key: "n_surveys", label: "Surveys", num: true, title: "Number of independent surveys", cell: (r) => esc(r.n_surveys ?? "–") },
  { key: "_flags", label: "Flags", sortValue: (r) => (r.z_conflict ? 2 : 0) + (r.close_pair ? 1 : 0), cell: (r) => flagCell(r) }
];

function renderTable() {
  const limit = clamp(Math.trunc(num(els.displayLimitInput.value) || DEFAULT_DISPLAY_LIMIT), 50, 20000);
  const rows = state.filtered.slice(0, limit);
  const head = els.resultsTable.querySelector("thead");
  const body = els.resultsTable.querySelector("tbody");
  head.innerHTML = `<tr>${TABLE_COLUMNS.map((c) => {
    const arrow = state.sort.key === c.key ? (state.sort.dir > 0 ? " ↑" : " ↓") : "";
    const unit = c.unit ? `<span class="unit">${esc(c.unit)}</span>` : "";
    return `<th data-key="${c.key}" class="${c.sticky ? "sticky-name" : ""} ${c.num ? "num" : ""}" title="${esc(c.title || "Sort by " + c.label)}" scope="col">${esc(c.label)}${arrow}${unit}</th>`;
  }).join("")}</tr>`;
  body.innerHTML = rows.length
    ? rows.map((r) => `<tr data-id="${r.id}" tabindex="0" class="${r.id === state.selectedId ? "is-selected" : ""}">${TABLE_COLUMNS
      .map((c) => `<td class="${c.sticky ? "sticky-name" : ""} ${c.num ? "num" : ""}">${c.cell(r)}</td>`).join("")}</tr>`).join("")
    : `<tr><td class="empty-state" colspan="${TABLE_COLUMNS.length}">No clusters match these filters.</td></tr>`;
  els.tableSummary.textContent = `Showing ${fmtInt(rows.length)} of ${fmtInt(state.filtered.length)} matching clusters.`;
}

function zCell(r) {
  if (!Number.isFinite(r.z)) return "–";
  const tag = r.z_type === "spec" ? `<span class="tag tag--spec" title="spectroscopic">s</span>`
    : r.z_type === "phot" ? `<span class="tag" title="photometric">p</span>` : "";
  return `${fix(r.z, 3)}${tag}`;
}

function famBadges(r, full = false) {
  const abbrev = full ? { SZ: "SZ", "X-ray": "X-ray", optical: "Optical", IR: "IR" } : { SZ: "SZ", "X-ray": "X", optical: "O", IR: "IR" };
  return ["SZ", "X-ray", "optical", "IR"].filter((f) => r._fams.has(f))
    .map((f) => `<span class="fam" title="${FAMILY_STYLE[f].label}"><span class="fam-dot" style="background:${FAMILY_STYLE[f].color}"></span>${abbrev[f]}</span>`).join("");
}

function radioBadges(r) {
  return RADIO_KINDS.filter(([k]) => r[`radio_${k}`]).map(([k, label, abbr]) => {
    const cand = r[`radio_${k}`] === "candidate";
    return `<span class="rtag${cand ? " rtag--cand" : ""}" title="${label}${cand ? " (candidate)" : ""}">${abbr}${cand ? "?" : ""}</span>`;
  }).join("") || (r.radio_none ? `<span class="muted" title="Observed; no diffuse emission detected">none</span>` : "");
}

function radioDetail(row) {
  const lines = RADIO_KINDS.filter(([k]) => row[`radio_${k}_src`]).map(([k, label]) => {
    const refs = String(row[`radio_${k}_src`]).split(",").map((item) => {
      const [cat, status] = item.split(":");
      const info = state.catalogInfo[cat] || {};
      const link = info.url ? `<a href="${esc(info.url)}" target="_blank" rel="noopener" title="${esc(info.reference || "")}">${esc(info.label || cat)}</a>` : esc(cat);
      return `${link}${status === "candidate" ? " (candidate)" : ""}`;
    });
    return `<div class="radio-line"><strong>${label}</strong> ${refs.join(", ")}</div>`;
  });
  if (!lines.length) {
    return row.radio_none ? "None detected" : (row.radio_summary ? esc(row.radio_summary) : "–");
  }
  return lines.join("");
}

function flagCell(r) {
  const out = [];
  if (r.z_conflict) out.push(`<span class="flag" title="Catalog redshifts disagree (spread ${fix(r.z_spread, 2)})">⚠ z</span>`);
  if (r.close_pair) out.push(`<span class="flag" title="Another cluster ${fix(r.nn_sep_arcmin, 1)}′ away">⚠ pair</span>`);
  return out.join(" ") || "";
}

/* ------------------------------------------------------------------ selection & details */

function selectCluster(id, { updateHash = true } = {}) {
  const row = state.byId.get(id);
  if (!row) return;
  state.selectedId = id;
  if (updateHash) {
    history.replaceState(null, "", `#${encodeURIComponent(row.name)}`);
  }
  els.resultsTable.querySelectorAll("tr.is-selected").forEach((tr) => tr.classList.remove("is-selected"));
  els.resultsTable.querySelector(`tr[data-id="${id}"]`)?.classList.add("is-selected");
  updateSelectionTraces();
  renderDetails(row);
}

function renderDetails(row) {
  els.detailName.textContent = row.name || "-";
  els.detailAliases.innerHTML = (row.alt_names || [])
    .map((n) => `<span class="chip chip--quiet">${esc(n)}</span>`).join("");

  const flags = [];
  if (row.z_conflict) {
    flags.push(`<span class="chip chip--warn">⚠ Catalog redshifts disagree (spread Δz = ${fix(row.z_spread, 2)}); see the table below</span>`);
  }
  if (row.close_pair) {
    const nn = state.byId.get(row.nn_id);
    flags.push(`<span class="chip chip--warn">⚠ ${nn ? `<a href="#" data-select-id="${nn.id}">${esc(nn.name)}</a>` : "Another cluster"} is ${fix(row.nn_sep_arcmin, 1)}′ away</span>`);
  }
  els.detailFlags.innerHTML = flags.join("");

  const hms = raToHms(row.ra);
  const dms = decToDms(row.dec);
  els.detailCoords.innerHTML = `
    <div class="coord-wide"><span class="summary-label">RA, Dec (J2000)</span>
      <span class="coord-line"><strong>${hms} ${dms}</strong><button class="copy" type="button" data-copy="${hms} ${dms}">Copy</button></span></div>
    <div class="coord-wide"><span class="summary-label">Degrees</span>
      <span class="coord-line"><strong>${fix(row.ra, 5)} ${fix(row.dec, 5)}</strong><button class="copy" type="button" data-copy="${fix(row.ra, 5)} ${fix(row.dec, 5)}">Copy</button></span></div>
    <div><span class="summary-label">Galactic l, b</span><strong>${fix(row.l, 2)}° ${fix(row.b, 2)}°</strong></div>
    <div><span class="summary-label">Position from</span><strong>${esc(catLabel(row.pos_src))}</strong></div>`;

  const zText = Number.isFinite(row.z)
    ? `${fix(row.z, 4)}${row.z_err > 0 ? ` ± ${fix(row.z_err, 3)}` : ""} <span class="muted">${esc(row.z_type || "type unknown")}</span>`
    : "–";
  const mText = Number.isFinite(row.m500)
    ? `${fix(row.m500, 2)}${Number.isFinite(row.m500_err) ? ` ± ${fix(row.m500_err, 2)}` : ""} ×10<sup>14</sup> M<sub>☉</sub>`
    : "–";
  const defn = state.catalogInfo[row.m500_src]?.m500_def || "";
  const facts = [
    ["Redshift", zText, row.z_src ? `from ${catLabel(row.z_src)}` : ""],
    ["M500c (adopted)", mText, row.m500_src ? `from ${catLabel(row.m500_src)}` : "", defn],
    ["R500 · θ500", Number.isFinite(row.r500_mpc) ? `${fix(row.r500_mpc, 2)} Mpc · ${fix(row.theta500_arcmin, 1)}′` : "–", "from adopted M500, z (Planck18)"],
    ["SZ S/N", Number.isFinite(row.sz_snr) ? fix(row.sz_snr, 1) : "–", row.sz_snr_src ? catLabel(row.sz_snr_src) : ""],
    ["Richness", Number.isFinite(row.richness) ? fix(row.richness, 1) : "–", row.richness_src ? catLabel(row.richness_src) : ""],
    ["Dynamical state", row.dyn_state ? `${esc(row.dyn_state)}` : "–", Number.isFinite(row.dyn_delta) ? `δ = ${fix(row.dyn_delta, 2)} (Yuan & Han)` : ""],
    ["Catalogs", `${row.n_catalogs ?? "–"} entries`, `${row.n_surveys ?? "–"} independent surveys`],
    ["Detected in", famBadges(row, true) || "–", ""],
    ["Diffuse radio", radioDetail(row), row.radio_catalogs ? "each classification links to its paper; see also the table below" : "not covered by the radio compilations"]
  ];
  els.detailFacts.innerHTML = facts.map(([label, value, sub, title]) => `
    <div class="summary-card"${title ? ` title="${esc(title)}"` : ""}>
      <span class="summary-label">${esc(label)}</span>
      <strong>${value}</strong>
      ${sub ? `<span class="summary-sub">${esc(sub)}</span>` : ""}
    </div>`).join("");

  const massRows = [
    ["SPT", row.m500_spt, row.m500_spt_err, row.m500_spt_src],
    ["ACT", row.m500_act, row.m500_act_err, row.m500_act_src],
    ["X-ray", row.m500_xray, row.m500_xray_err, row.m500_xray_src],
    ["Planck", row.m500_planck, row.m500_planck_err, Number.isFinite(row.m500_planck) ? "psz2" : null]
  ];
  els.massTable.querySelector("tbody").innerHTML = massRows.map(([fam, m, e, src]) => `
    <tr><td>${fam}</td>
      <td class="num">${Number.isFinite(m) ? `${fix(m, 2)}${Number.isFinite(e) ? ` ± ${fix(e, 2)}` : ""}` : "–"}</td>
      <td class="muted">${src ? esc(catLabel(src)) : ""}</td></tr>`).join("");

  els.externalLinks.innerHTML = externalLinks(row).map(([label, url]) =>
    `<a class="link-chip" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`).join("");

  els.fieldsTable.querySelector("tbody").innerHTML = state.columns
    .filter((c) => row[c] !== undefined)
    .map((c) => `<tr><td>${esc(c)}</td><td>${esc(Array.isArray(row[c]) ? row[c].join(" | ") : row[c])}</td></tr>`).join("");

  renderMembers(row);
  if (!els.panelsWrap.hidden) renderPanels(row);
  renderViewer(row);
}

/* ---------- image viewer: static cutout (fast, no CDS) or interactive Aladin (opt-in) */

function currentViewMode(row) {
  return state.viewMode || (inLegacy(row) ? "static" : "aladin");
}

function setViewMode(mode) {
  state.viewMode = mode;
  const row = state.byId.get(state.selectedId);
  if (row) renderViewer(row);
}

function renderViewer(row) {
  const mode = currentViewMode(row);
  const isStatic = mode === "static";
  els.viewStaticBtn.setAttribute("aria-pressed", String(isStatic));
  els.viewAladinBtn.setAttribute("aria-pressed", String(!isStatic));
  els.staticLayerLabel.hidden = !isStatic;
  els.surveyLabel.hidden = isStatic;
  els.staticView.hidden = !isStatic;
  els.aladinContainer.hidden = isStatic;
  els.aladinLegend.innerHTML = "";
  if (isStatic) {
    state.aladinReady = null;
    els.aladinContainer.innerHTML = "";
    renderStatic(row);
    return;
  }
  probeAllSurveys(); // only once the interactive viewer is actually used
  const keep = state.surveyChosen && HIPS_BY_KEY[els.surveySelect.value].covers(row);
  (keep ? Promise.resolve(els.surveySelect.value) : defaultSurvey(row)).then((key) => {
    if (state.selectedId !== row.id || currentViewMode(row) !== "aladin") return;
    els.surveySelect.value = key;
    renderAladin(row).then(() => addMemberOverlayFromCache(row));
  });
}

async function renderStatic(row) {
  const size = 512;
  const fovArcmin = clamp(Math.max(8, 4 * (row.theta500_arcmin || 0)), 4, 40);
  const pixscale = (fovArcmin * 60) / size;
  const layer = els.staticLayerSelect.value;
  const src = `https://www.legacysurvey.org/viewer/jpeg-cutout?ra=${row.ra.toFixed(5)}&dec=${row.dec.toFixed(5)}&layer=${layer}&pixscale=${pixscale.toFixed(3)}&size=${size}`;
  const outside = layer.startsWith("ls-") && !inLegacy(row);
  els.staticView.innerHTML = `
    <div class="static-frame">
      <img src="${esc(src)}" alt="${esc(layer)} cutout of ${esc(row.name)}" onerror="this.parentElement.classList.add('mw-missing')">
      <svg id="staticOverlay" class="static-overlay" viewBox="0 0 ${size} ${size}"></svg>
    </div>
    <p class="hint">${fovArcmin.toFixed(1)}′ × ${fovArcmin.toFixed(1)}′, north up, east left (legacysurvey.org).${outside ? " This position is probably outside the Legacy Surveys footprint; try Interactive (Aladin) or the panels." : ""}</p>`;
  let members = [];
  let val = () => undefined;
  try {
    const shard = await getShard(row);
    members = shard.clusters?.[String(row.id)] || [];
    const idx = Object.fromEntries((shard.fields || []).map((name, i) => [name, i]));
    val = (m, name) => m[idx[name]];
  } catch (error) {
    /* overlay without member positions */
  }
  const svg = document.getElementById("staticOverlay");
  if (!svg || state.selectedId !== row.id) return;
  const cosd = Math.cos(row.dec * Math.PI / 180);
  const toXY = (ra, dec) => {
    let dra = ra - row.ra;
    if (dra > 180) dra -= 360;
    if (dra < -180) dra += 360;
    return [size / 2 - (dra * cosd * 3600) / pixscale, size / 2 - ((dec - row.dec) * 3600) / pixscale];
  };
  const shapes = [];
  if (Number.isFinite(row.theta500_arcmin)) {
    shapes.push(`<circle class="ov-ring" cx="${size / 2}" cy="${size / 2}" r="${((row.theta500_arcmin * 60) / pixscale).toFixed(1)}"><title>θ500 = ${fix(row.theta500_arcmin, 1)}′</title></circle>`);
  }
  const seen = new Set();
  for (const m of members) {
    const info = state.catalogInfo[val(m, "catalog")] || {};
    if (info.family === "radio") continue; // classification entries sit at the cluster centre
    const style = FAMILY_STYLE[info.family] || FAMILY_STYLE.optical;
    const [x, y] = toXY(val(m, "ra"), val(m, "dec"));
    if (x < 0 || y < 0 || x > size || y > size) continue;
    seen.add(info.family || "optical");
    const title = `<title>${esc(catLabel(val(m, "catalog")))}: ${esc(val(m, "name") || "")}</title>`;
    const r = 9;
    const shape = style.shape === "square" ? `<rect x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${2 * r}" height="${2 * r}" />`
      : style.shape === "rhomb" ? `<path d="M${x.toFixed(1)} ${(y - r - 2).toFixed(1)}l${r + 2} ${r + 2}l${-(r + 2)} ${r + 2}l${-(r + 2)} ${-(r + 2)}z" />`
      : style.shape === "triangle" ? `<path d="M${x.toFixed(1)} ${(y - r - 1).toFixed(1)}l${r + 1} ${2 * r}h${-2 * (r + 1)}z" />`
      : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" />`;
    shapes.push(`<g class="ov-member" style="stroke:${style.color}">${shape}${title}</g>`);
  }
  shapes.push(`<path class="ov-centre" d="M${size / 2 - 10} ${size / 2}h20M${size / 2} ${size / 2 - 10}v20"><title>Adopted position</title></path>`);
  svg.innerHTML = shapes.join("");
  els.aladinLegend.innerHTML = [...["SZ", "X-ray", "optical", "IR"].filter((f) => seen.has(f)).map((f) => {
    const st = FAMILY_STYLE[f];
    return `<span class="legend-item"><span class="legend-shape legend-shape--${st.shape}" style="border-color:${st.color};color:${st.color}"></span>${esc(st.label)} positions</span>`;
  }), `<span class="legend-item"><span class="legend-shape legend-shape--plus" style="color:${INK}"></span>Adopted</span>`,
  ...(Number.isFinite(row.theta500_arcmin) ? [`<span class="legend-item"><span class="legend-ring"></span>θ500</span>`] : [])].join("");
}

function externalLinks(row) {
  const ra = row.ra.toFixed(5);
  const dec = row.dec.toFixed(5);
  const sign = row.dec >= 0 ? "%2B" : "";
  return [
    ["NED", `https://ned.ipac.caltech.edu/conesearch?search_type=Near%20Position%20Search&in_csys=Equatorial&in_equinox=J2000&ra=${ra}&dec=${dec}&radius=2`],
    ["SIMBAD", `https://simbad.cds.unistra.fr/simbad/sim-coo?Coord=${ra}%20${sign}${dec}&Radius=2&Radius.unit=arcmin`],
    ["ADS", `https://ui.adsabs.harvard.edu/search/q=${encodeURIComponent(`object:"${row.name}"`)}&sort=date%20desc`],
    ["Legacy Viewer", `https://www.legacysurvey.org/viewer?ra=${ra}&dec=${dec}&layer=ls-dr10&zoom=14`],
    ["ESASky", `https://sky.esa.int/esasky/?target=${ra}%20${dec}&hips=DSS2%20color&fov=0.2&cooframe=J2000&sci=true`]
  ];
}

/* ---------- Aladin */

async function renderAladin(row) {
  const fovDeg = clamp(Math.max(8, 4 * (row.theta500_arcmin || 0)), 4, 60) / 60;
  const survey = HIPS_BY_KEY[els.surveySelect.value];
  const surveyUrl = await resolveHips(survey);
  if (state.selectedId !== row.id) return;
  if (!surveyUrl) {
    els.aladinContainer.innerHTML = `<div class="aladin-empty">${esc(survey.title)} is unreachable right now; pick another image.</div>`;
    return;
  }
  els.aladinContainer.innerHTML = `<div id="aladin-lite-view" style="width:100%;height:440px;"><div class="aladin-empty">Loading Aladin Lite…</div></div>`;
  els.aladinLegend.innerHTML = "";
  state.aladinReady = loadAladin().then(() => {
    document.getElementById("aladin-lite-view").innerHTML = "";
    state.aladin = A.aladin("#aladin-lite-view", {
      target: `${row.ra} ${row.dec}`,
      fov: fovDeg,
      survey: surveyUrl,
      cooFrame: "J2000",
      showLayersControl: true,
      showGotoControl: true,
      showZoomControl: true,
      showFullscreenControl: true,
      showContextMenu: true
    });
    applyColormap(state.aladin, survey);
    return state.aladin;
  });
  const ready = state.aladinReady;
  ready.catch(() => {
    if (state.aladinReady === ready && state.selectedId === row.id) {
      els.aladinContainer.innerHTML = `<div class="aladin-empty">Aladin is not responding (the CDS servers are under heavy load). Use the Image view or the multiwavelength panels.</div>`;
    }
  });
  ready.catch(() => null).then((aladin) => {
    if (!aladin || state.selectedId !== row.id || state.aladinReady !== ready) return;
    const centre = A.catalog({ name: "Adopted position", sourceSize: 20, color: "#ffffff", shape: "plus" });
    aladin.addCatalog(centre);
    centre.addSources([A.source(row.ra, row.dec, { name: row.name })]);
    if (Number.isFinite(row.theta500_arcmin)) {
      const overlay = A.graphicOverlay({ color: "#ffe9b0", lineWidth: 1.5, name: "θ500" });
      aladin.addOverlay(overlay);
      overlay.add(A.circle(row.ra, row.dec, row.theta500_arcmin / 60));
    }
  });
}

function setAladinSurvey() {
  const row = state.byId.get(state.selectedId);
  if (row && currentViewMode(row) === "aladin") {
    renderAladin(row).then(() => addMemberOverlayFromCache(row));
  }
}

async function addMemberOverlayFromCache(row) {
  try {
    const shard = await getShard(row);
    const members = shard.clusters?.[String(row.id)] || [];
    const idx = Object.fromEntries((shard.fields || []).map((name, i) => [name, i]));
    addMemberOverlay(row, members, (m, name) => m[idx[name]]);
  } catch (error) {
    /* measurements table reports the failure */
  }
}

function applyColormap(aladin, survey) {
  if (!survey || !survey.cmap) return;
  try {
    const layer = aladin.getBaseImageLayer();
    if (layer && layer.setColormap) layer.setColormap(survey.cmap, { stretch: "asinh" });
  } catch (error) {
    console.warn("colormap", error);
  }
}

/* ---------- multiwavelength panels (on demand) */

function renderPanels(row) {
  const fovArcmin = els.panelFovSelect.value === "auto"
    ? clamp(5 * (row.theta500_arcmin || 1.6), 4, 40)
    : Number(els.panelFovSelect.value);
  const size = 256;
  const pixscale = (fovArcmin * 60) / size; // arcsec / pixel
  const cutouts = CUTOUT_PANELS.filter((c) => c.covers(row));
  const hips = HIPS_SURVEYS.filter((h) => ["euclid_q1", "unwise", "erosita", "lotss_dr3", "racs_mid", "nvss"].includes(h.key) && h.covers(row));
  if (!inLegacy(row)) hips.unshift(row.dec > -30 ? HIPS_BY_KEY.ps1 : HIPS_BY_KEY.dss2);
  const ring = Number.isFinite(row.theta500_arcmin) ? (row.theta500_arcmin * 60) / pixscale : null;
  const overlaySvg = `<svg class="mw-overlay" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      ${ring ? `<circle cx="${size / 2}" cy="${size / 2}" r="${ring.toFixed(1)}" />` : ""}
      <path d="M${size / 2 - 7} ${size / 2}h14M${size / 2} ${size / 2 - 7}v14" /></svg>`;
  const cutHtml = cutouts.map((c) => {
    const src = `https://www.legacysurvey.org/viewer/jpeg-cutout?ra=${row.ra.toFixed(5)}&dec=${row.dec.toFixed(5)}&layer=${c.layer}&pixscale=${pixscale.toFixed(3)}&size=${size}`;
    const link = `https://www.legacysurvey.org/viewer?ra=${row.ra.toFixed(5)}&dec=${row.dec.toFixed(5)}&layer=${c.layer}&zoom=14`;
    return `<figure class="mw-panel">
      <figcaption><a class="mw-title" href="${esc(link)}" target="_blank" rel="noopener">${esc(c.title)} ↗</a>
        <span class="mw-band">${esc(c.kind)} · ${esc(c.band)}</span></figcaption>
      <div class="mw-view"><img src="${esc(src)}" alt="${esc(c.title)} cutout of ${esc(row.name)}" loading="lazy"
        onerror="this.parentElement.classList.add('mw-missing')">${overlaySvg}</div>
    </figure>`;
  });
  const hipsHtml = hips.map((h) => `<figure class="mw-panel" data-hips="${h.key}">
      <figcaption><button type="button" class="mw-title" data-survey="${h.key}" title="Open in the main viewer">${esc(h.title)}</button>
        <span class="mw-band">${esc(h.kind)} · ${esc(h.band)}</span></figcaption>
      <div id="mw-${h.key}" class="mw-view"><span class="mw-note">Loading…</span></div>
    </figure>`);
  els.panelsGrid.innerHTML = [...cutHtml, ...hipsHtml].join("");

  const id = row.id;
  if (!hips.length) return;
  loadAladin().catch(() => {
    hips.forEach((h) => {
      const box = document.getElementById(`mw-${h.key}`);
      if (box && box.querySelector(".mw-note")) box.innerHTML = `<span class="mw-note">Aladin not responding (CDS under load)</span>`;
    });
    return Promise.reject(new Error("aladin unavailable"));
  }).then(() => {
    hips.forEach(async (h) => {
      const url = await resolveHips(h);
      const box = document.getElementById(`mw-${h.key}`);
      if (state.selectedId !== id || els.panelsWrap.hidden || !box) return;
      if (!url) {
        box.innerHTML = `<span class="mw-note">Server unreachable right now</span>`;
        return;
      }
      box.innerHTML = "";
      const view = A.aladin(`#mw-${h.key}`, {
        target: `${row.ra} ${row.dec}`, fov: fovArcmin / 60, survey: url, cooFrame: "J2000",
        showReticle: false, showZoomControl: false, showLayersControl: false, showGotoControl: false,
        showFullscreenControl: false, showFrame: false, showCooGridControl: false, showProjectionControl: false,
        showSimbadPointerControl: false, showSettingsControl: false, showShareControl: false,
        showStatusBar: false, showContextMenu: false, showCooLocation: false
      });
      applyColormap(view, h);
      const centre = A.catalog({ name: "Adopted", sourceSize: 16, color: "#ffffff", shape: "plus" });
      view.addCatalog(centre);
      centre.addSources([A.source(row.ra, row.dec, { name: row.name })]);
      if (Number.isFinite(row.theta500_arcmin)) {
        const circle = A.graphicOverlay({ color: "#ffe9b0", lineWidth: 1.5 });
        view.addOverlay(circle);
        circle.add(A.circle(row.ra, row.dec, row.theta500_arcmin / 60));
      }
    });
  }).catch(() => {});
}

function addMemberOverlay(row, members, val) {
  if (!state.aladinReady) return;
  const ready = state.aladinReady;
  ready.catch(() => null).then((aladin) => {
    if (!aladin) return;
    if (state.selectedId !== row.id || state.aladinReady !== ready) return;
    const byFam = {};
    for (const m of members) {
      const fam = state.catalogInfo[val(m, "catalog")]?.family || "optical";
      if (fam === "radio") continue; // classification entries sit at the cluster centre
      (byFam[fam] = byFam[fam] || []).push(m);
    }
    const legend = [];
    for (const [fam, list] of Object.entries(byFam)) {
      const style = FAMILY_STYLE[fam] || FAMILY_STYLE.optical;
      const cat = A.catalog({ name: `${style.label} positions`, sourceSize: 14, color: style.color, shape: style.shape });
      aladin.addCatalog(cat);
      cat.addSources(list.map((m) => A.source(val(m, "ra"), val(m, "dec"), { name: val(m, "name"), catalog: catLabel(val(m, "catalog")) })));
      legend.push(`<span class="legend-item"><span class="legend-shape legend-shape--${style.shape}" style="border-color:${style.color};color:${style.color}"></span>${esc(style.label)}</span>`);
    }
    legend.push(`<span class="legend-item"><span class="legend-shape legend-shape--plus" style="color:${INK}"></span>Adopted</span>`);
    if (Number.isFinite(row.theta500_arcmin)) legend.push(`<span class="legend-item"><span class="legend-ring"></span>θ500</span>`);
    els.aladinLegend.innerHTML = legend.join("");
  });
}

/* ---------- per-catalog measurements */

async function getShard(row) {
  const shard = String(clamp(Math.floor((((row.ra % 360) + 360) % 360) / 15), 0, 23)).padStart(2, "0");
  if (!state.shards[shard]) {
    state.shards[shard] = fetchJsonGzip(`./data/members/ra_${shard}.json.gz`).catch((error) => {
      delete state.shards[shard];
      throw error;
    });
  }
  return state.shards[shard];
}

async function renderMembers(row) {
  const head = els.membersTable.querySelector("thead");
  const body = els.membersTable.querySelector("tbody");
  head.innerHTML = "";
  body.innerHTML = `<tr><td class="empty-state">Loading catalog measurements…</td></tr>`;
  let shard;
  try {
    shard = await getShard(row);
  } catch (error) {
    body.innerHTML = `<tr><td class="empty-state">Catalog measurements unavailable.</td></tr>`;
    return;
  }
  if (state.selectedId !== row.id) return;
  const members = shard.clusters?.[String(row.id)] || [];
  const idx = Object.fromEntries((shard.fields || []).map((name, i) => [name, i]));
  const val = (m, name) => m[idx[name]];

  head.innerHTML = `<tr>${[["Catalog"], ["Name"], ["Offset", "″"], ["z"], ["M500", "10¹⁴ M☉"], ["S/N"], ["Richness"], ["Notes"]]
    .map(([h, u]) => `<th scope="col">${esc(h)}${u ? `<span class="unit">${esc(u)}</span>` : ""}</th>`).join("")}</tr>`;
  body.innerHTML = members.map((m) => {
    const key = val(m, "catalog");
    const info = state.catalogInfo[key] || {};
    const style = FAMILY_STYLE[info.family] || FAMILY_STYLE.optical;
    const z = val(m, "z");
    const ze = val(m, "z_err");
    const m500 = val(m, "m500");
    const lo = val(m, "m500_lo");
    const hi = val(m, "m500_hi");
    const extra = val(m, "extra") || {};
    const notes = [val(m, "note"), ...Object.entries(extra).map(([k, v]) => `${k}=${v}`)].filter(Boolean).join("; ");
    const label = info.url
      ? `<a href="${esc(info.url)}" target="_blank" rel="noopener" title="${esc(info.reference || "")}">${esc(catLabel(key))}</a>`
      : esc(catLabel(key));
    const zTxt = Number.isFinite(z) ? `${fix(z, 4)}${ze > 0 ? ` ± ${fix(ze, 3)}` : ""}${val(m, "z_type") ? ` <span class="muted">${esc(val(m, "z_type"))}</span>` : ""}` : "–";
    const mTxt = Number.isFinite(m500) ? `${fix(m500, 2)}${Number.isFinite(hi) ? ` <span class="muted">+${fix(hi, 2)}/−${fix(lo, 2)}</span>` : ""}` : "–";
    return `<tr class="${info.superseded_by ? "superseded" : ""}">
      <td><span class="fam-dot" style="background:${style.color}" title="${esc(info.family || "")}"></span>${label}</td>
      <td>${esc(val(m, "name") || "–")}</td>
      <td class="num">${fix(val(m, "sep_arcsec"), 1)}</td>
      <td class="${key === row.z_src ? "adopted" : ""}">${zTxt}</td>
      <td class="${key === row.m500_src ? "adopted" : ""}" title="${esc(info.m500_def || "")}">${mTxt}</td>
      <td class="num">${fix(val(m, "snr"), 1)}</td>
      <td class="num">${fix(val(m, "richness"), 1)}</td>
      <td class="notes">${esc(notes)}</td>
    </tr>`;
  }).join("") || `<tr><td class="empty-state" colspan="8">No catalog entries found.</td></tr>`;
}

/* ------------------------------------------------------------------ sidebar content */

function renderCatalogChecklist(keys) {
  const fams = ["SZ", "X-ray", "radio", "optical", "IR"];
  const byFam = {};
  keys.forEach((k) => {
    const fam = state.catalogInfo[k]?.family || "optical";
    (byFam[fam] = byFam[fam] || []).push(k);
  });
  els.requiredCatalogs.innerHTML = fams.filter((f) => byFam[f]).map((f) => `
    <p class="catalog-group">${esc(FAMILY_STYLE[f].label)}</p>
    ${byFam[f].map((k) => `
      <label class="checkbox-item" title="${esc(state.catalogInfo[k]?.reference || k)}">
        <input type="checkbox" value="${esc(k)}">
        <span>${esc(catLabel(k))}</span>
        <span class="legend-count">${fmtInt(state.catalogInfo[k]?.n_entries || 0)}</span>
      </label>`).join("")}`).join("");
  els.catalogCount.textContent = String(keys.length);
}

function renderAbout() {
  const meta = state.meta;
  const when = meta.generated ? new Date(meta.generated).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
  els.buildInfo.textContent = `${fmtInt(meta.n_members || 0)} entries from ${(meta.catalogs || []).length} catalogs, grouped into ${fmtInt(meta.n_clusters || state.rows.length)} clusters${when ? ` (built ${when})` : ""}.`;
  if (meta.pipeline_url) els.pipelineLink.href = meta.pipeline_url;
  const order = ["SZ", "X-ray", "radio", "optical", "IR"];
  els.catalogRefs.innerHTML = [...(meta.catalogs || [])]
    .sort((a, b) => order.indexOf(a.family) - order.indexOf(b.family))
    .map((c) => `
      <div class="catalog-ref">
        <strong>${esc(c.label)}</strong>
        <div class="ref-meta">${esc(c.family)} · ${fmtInt(c.n_entries)} entries${c.superseded_by ? ` · superseded by ${esc(catLabel(c.superseded_by))}` : ""}</div>
        <div><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.reference)}</a></div>
        ${c.m500_def ? `<div class="ref-caveat">M500: ${esc(c.m500_def)}</div>` : ""}
        ${c.caveats ? `<div class="ref-caveat">${esc(c.caveats)}</div>` : ""}
      </div>`).join("");
}

/* ------------------------------------------------------------------ downloads */

function downloadCsv() {
  const cols = state.columns;
  const lines = [cols.join(",")].concat(state.filtered.map((r) => cols.map((c) => csvCell(Array.isArray(r[c]) ? r[c].join(" | ") : r[c])).join(",")));
  saveText(lines.join("\n"), "clusters_filtered.csv", "text/csv");
}

function downloadTargets() {
  const header = "name,ra_hms,dec_dms,ra_deg,dec_deg,z,z_type,m500_1e14,m500_source";
  const lines = state.filtered.map((r) => [r.name, raToHms(r.ra), decToDms(r.dec), fix(r.ra, 5), fix(r.dec, 5),
    Number.isFinite(r.z) ? fix(r.z, 4) : "", r.z_type || "", Number.isFinite(r._m) ? fix(r._m, 3) : "", r._ms ? catLabel(r._ms) : ""]
    .map(csvCell).join(","));
  saveText([header, ...lines].join("\n"), "cluster_targets.csv", "text/csv");
}

function saveText(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* ------------------------------------------------------------------ astronomy helpers */

function mollweide(lonDeg, latDeg) {
  // RA increases to the left: longitude is negated.
  const lam = (-lonDeg * Math.PI) / 180;
  const phi = (latDeg * Math.PI) / 180;
  let theta = phi;
  if (Math.abs(phi) >= Math.PI / 2 - 1e-9) {
    theta = Math.sign(phi) * Math.PI / 2;
  } else {
    for (let i = 0; i < 12; i += 1) {
      const d = (2 * theta + Math.sin(2 * theta) - Math.PI * Math.sin(phi)) / (2 + 2 * Math.cos(2 * theta));
      theta -= d;
      if (Math.abs(d) < 1e-7) break;
    }
  }
  return [(2 * Math.SQRT2 / Math.PI) * lam * Math.cos(theta), Math.SQRT2 * Math.sin(theta)];
}

function pushXY(target, [x, y]) {
  target.x.push(x);
  target.y.push(y);
}

function wrapRaDec([ra, dec]) {
  return [ra > 180 ? ra - 360 : ra, dec];
}

function galacticToEquatorial(lDeg, bDeg) {
  // ICRS <- Galactic rotation (transpose of the equatorial->galactic matrix)
  const R = [
    [-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
    [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
    [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]
  ];
  const l = lDeg * Math.PI / 180;
  const b = bDeg * Math.PI / 180;
  const g = [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)];
  const e = [0, 1, 2].map((i) => R[0][i] * g[0] + R[1][i] * g[1] + R[2][i] * g[2]);
  const ra = (Math.atan2(e[1], e[0]) * 180 / Math.PI + 360) % 360;
  const dec = Math.asin(clamp(e[2], -1, 1)) * 180 / Math.PI;
  return [ra, dec];
}

function angSepDeg(ra1, dec1, ra2, dec2) {
  const r = Math.PI / 180;
  const c = Math.sin(dec1 * r) * Math.sin(dec2 * r) + Math.cos(dec1 * r) * Math.cos(dec2 * r) * Math.cos((ra1 - ra2) * r);
  return Math.acos(clamp(c, -1, 1)) / r;
}

function parseCoordinates(text) {
  const s = String(text || "").trim().replace(/[−–]/g, "-");
  if (!s) return null;
  const sexagesimal = /[:hms°′″'"]/i.test(s);
  const tokens = s.replace(/[hdms°′″'":,]/gi, " ").trim().split(/\s+/).filter(Boolean);
  if (!sexagesimal && tokens.length === 2) {
    const ra = Number(tokens[0]);
    const dec = Number(tokens[1]);
    return Number.isFinite(ra) && Number.isFinite(dec) && ra >= 0 && ra < 360 && Math.abs(dec) <= 90 ? { ra, dec } : null;
  }
  if (tokens.length === 6) {
    const [h, m, sec, d, dm, ds] = tokens.map(Number);
    if ([h, m, sec, d, dm, ds].some((v) => !Number.isFinite(v))) return null;
    const sign = tokens[3].startsWith("-") ? -1 : 1;
    const ra = 15 * (h + m / 60 + sec / 3600);
    const dec = sign * (Math.abs(d) + dm / 60 + ds / 3600);
    return ra >= 0 && ra < 360 && Math.abs(dec) <= 90 ? { ra, dec } : null;
  }
  return null;
}

function raToHms(ra) {
  let cs = Math.round(((((ra % 360) + 360) % 360) / 15) * 3600 * 100);
  cs %= 24 * 3600 * 100;
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = (cs % 6000) / 100;
  return `${pad(h)}:${pad(m)}:${s.toFixed(2).padStart(5, "0")}`;
}

function decToDms(dec) {
  const sign = dec < 0 ? "-" : "+";
  const ds = Math.round(Math.abs(dec) * 3600 * 10);
  const d = Math.floor(ds / 36000);
  const m = Math.floor((ds % 36000) / 600);
  const s = (ds % 600) / 10;
  return `${sign}${pad(d)}:${pad(m)}:${s.toFixed(1).padStart(4, "0")}`;
}

/* ------------------------------------------------------------------ small utils */

function catLabel(key) {
  return state.catalogInfo[key]?.label || key || "";
}

function fmtZ(r) {
  return Number.isFinite(r.z) ? `z ${r.z.toFixed(3)}${r.z_type ? ` (${r.z_type})` : ""}` : "no z";
}

function fmtErr(e) {
  return Number.isFinite(e) ? ` ± ${e.toFixed(2)}` : "";
}

function abellNumbers(names) {
  const out = [];
  names.forEach((n) => {
    const m = String(n).trim().match(/^(abell|aco|a)\s*[-_]?\s*(s?)\s*0*(\d{1,5})\b/i);
    if (m) out.push((m[2] ? "S" : "") + String(Number(m[3])));
  });
  return out;
}

function compactName(value) {
  return String(value || "").toLowerCase().replace(/[\s\-_()[\]{},.;:|]/g, "");
}

function num(value) {
  if (value === null || value === undefined || value === "") return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function fix(value, digits) {
  const n = num(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "–";
}

function fmtInt(value) {
  return Number(value || 0).toLocaleString();
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function clamp(value, lo, hi) {
  return Math.min(Math.max(value, lo), hi);
}

function setStatus(text) {
  els.statusText.textContent = text;
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
