/* =========================================================
   RF Path Analyser – Online DEM + Fresnel + Diffraction + Relays
   Elevation backend: Open-Meteo (primary) + Open-Elevation (fallback)
   ========================================================= */

const state = {
  map: null,
  txMarker: null,
  rxMarker: null,

  // direct path drawing + analysis markers
  directLine: null,
  fresnelMarker: null,
  diffMarker: null,

  // relay
  relay: null,                // { latlng, marker }
  relayPathLines: [],         // polylines for relay legs
  relaySuggestLayer: null,    // markers from corridor scan
  lastRelaySuggestions: [],

  // high points
  highPointsLayer: L.layerGroup(),

  // charts + caching
  chart: null,
  profileCache: new Map(),
  pointElevCache: new Map(),
};

const el = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  el("loading").classList.add("hidden");
  initMap();
  wireUI();
  updateSummary();
});

function wireUI() {
  el("analyze").addEventListener("click", analyzePath);
  el("reverse").addEventListener("click", reversePath);
  el("clear-btn").addEventListener("click", clearTxRx);
  el("clear-relay-btn").addEventListener("click", () => { clearRelay(); analyzePath(); });

  el("units").addEventListener("change", updateSummary);

  el("copy-btn").addEventListener("click", copySummary);
  el("print-btn").addEventListener("click", () => window.print());

  el("save-btn").addEventListener("click", saveProject);
  el("load-btn").addEventListener("click", () => el("load-file").click());
  el("load-file").addEventListener("change", loadProjectFromFile);

  el("antenna-preset").addEventListener("change", updateAntennaUI);
  updateAntennaUI();

  // High points
  el("highpoints-btn").addEventListener("click", showHighPointsInView);
  el("clear-highpoints-btn").addEventListener("click", clearHighPoints);

  // Relays
  el("suggest-relays-btn").addEventListener("click", suggestRelaysCorridor);
  el("use-best-relay-btn").addEventListener("click", useBestRelay);
}

function initMap() {
  state.map = L.map("map", {
    zoomControl: true,
    preferCanvas: true
  }).setView([51.5, -2], 7);

  const street = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution: "© OpenStreetMap"
    }
  );

  const topo = L.tileLayer(
    "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 17,
      attribution: "© OpenTopoMap (CC-BY-SA)"
    }
  );

  const satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution: "© Esri"
    }
  );

  const terrain = L.tileLayer(
    "https://stamen-tiles.a.ssl.fastly.net/terrain/{z}/{x}/{y}.jpg",
    {
      maxZoom: 18,
      attribution: "Stamen Terrain"
    }
  );

  // default
  street.addTo(state.map);

  const baseLayers = {
    "Street": street,
    "Topographic": topo,
    "Satellite": satellite,
    "Terrain": terrain
  };

  L.control.layers(baseLayers, null, {
    position: "topright",
    collapsed: true
  }).addTo(state.map);

  state.map.on("click", (e) => {
    if (!state.txMarker) setMarker("tx", e.latlng);
    else if (!state.rxMarker) setMarker("rx", e.latlng);
    updateSummary();
  });

  addLegend();
  enableMapReadout();

  setTimeout(() => state.map.invalidateSize(), 150);
  window.addEventListener("resize", () => state.map.invalidateSize());
}


function addLegend() {
  const Legend = L.Control.extend({
    options: { position: "bottomright" },
    onAdd: function () {
      const div = L.DomUtil.create("div", "rf-legend");
      div.innerHTML = `
        <div class="title">Legend</div>
        <div class="row"><span class="swatch" style="background:#00ff66"></span> Good link</div>
        <div class="row"><span class="swatch" style="background:#ffaa00"></span> Marginal</div>
        <div class="row"><span class="swatch" style="background:#ff3344"></span> Poor</div>
        <hr style="border:none;border-top:1px solid rgba(255,255,255,0.12);margin:8px 0;">
        <div class="row"><span class="dot" style="background:#ffd400"></span> Worst Fresnel</div>
        <div class="row"><span class="dot" style="background:#ff4d6d"></span> Worst diffraction</div>
      `;
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      return div;
    }
  });
  state.map.addControl(new Legend());
}

/* ===================== Marker placement ===================== */

function updateAntennaUI() {
  const v = el("antenna-preset").value;
  el("custom-gain-wrap").classList.toggle("hidden", v !== "custom");
}

function setMarker(which, latlng) {
  const isTx = which === "tx";
  const existing = isTx ? state.txMarker : state.rxMarker;

  if (existing) state.map.removeLayer(existing);

  const marker = L.marker(latlng, { draggable: true })
    .addTo(state.map)
    .bindPopup(isTx ? "Tx" : "Rx");

  marker.on("dragend", () => updateSummary());

  if (isTx) state.txMarker = marker;
  else state.rxMarker = marker;
}

function clearTxRx() {
  if (state.txMarker) state.map.removeLayer(state.txMarker);
  if (state.rxMarker) state.map.removeLayer(state.rxMarker);
  state.txMarker = null;
  state.rxMarker = null;

  clearDirectDrawing();
  clearAnalysisMarkers();
  clearRelay();

  updateSummary();
  hideCritical();
}

function reversePath() {
  if (!state.txMarker || !state.rxMarker) return;
  const tx = state.txMarker.getLatLng();
  const rx = state.rxMarker.getLatLng();
  setMarker("tx", rx);
  setMarker("rx", tx);
  updateSummary();
}

function updateSummary() {
  const txLabel = el("tx-label");
  const rxLabel = el("rx-label");
  const bd = el("bearing-distance");

  const tx = state.txMarker ? state.txMarker.getLatLng() : null;
  const rx = state.rxMarker ? state.rxMarker.getLatLng() : null;

  const units = el("units").value;
  const bothUK = tx && rx && isInUK(tx) && isInUK(rx);

  const formatPoint = (p) => {
    if (!p) return "Click map";
    return bothUK ? toBNG(p, 10) : toMGRS(p, 5);
  };

  txLabel.textContent = formatPoint(tx);
  rxLabel.textContent = formatPoint(rx);

  if (tx && rx) {
    const d_km = haversineKm(tx, rx);
    const b = bearingDeg(tx, rx);

    const distText = units === "imperial"
      ? `${(d_km * 0.621371).toFixed(2)} mi`
      : `${d_km.toFixed(2)} km`;

    bd.textContent = `${distText} • ${b.toFixed(0)}°`;

    if (!state.relay) {
      drawDirectLine(tx, rx, "#00c8ff");
    }
  } else {
    bd.textContent = "";
    clearDirectDrawing();
  }
}

/* ===================== Drawing helpers ===================== */

function clearDirectDrawing() {
  if (state.directLine) state.map.removeLayer(state.directLine);
  state.directLine = null;
}

function drawDirectLine(a, b, color) {
  clearDirectDrawing();
  state.directLine = L.polyline([a, b], { color, weight: 5, opacity: 0.95 }).addTo(state.map);
  return state.directLine;
}

function drawLegLine(a, b, color) {
  const ln = L.polyline([a, b], { color, weight: 6, opacity: 0.95 }).addTo(state.map);
  return ln;
}

function clearAnalysisMarkers() {
  if (state.fresnelMarker) state.map.removeLayer(state.fresnelMarker);
  if (state.diffMarker) state.map.removeLayer(state.diffMarker);
  state.fresnelMarker = null;
  state.diffMarker = null;
}

/* ===================== Inputs ===================== */

function readInputs() {
  const freqMHz = num(el("frequency").value, 145.5);
  const txHeight_m = num(el("txHeight").value, 10);
  const rxHeight_m = num(el("rxHeight").value, 2);
  const txPowerW = Math.max(0.001, num(el("txPowerW").value, 50));
  const sysLossDb = Math.max(0, num(el("sysLossDb").value, 2));
  const rxSensDbm = num(el("rxSensDbm").value, -100);
  const fadeMarginDb = Math.max(0, num(el("fadeMarginDb").value, 15));
  const terrain = el("terrain-type").value;
  const fresnelFactor = Math.max(0, Math.min(1, num(el("fresnel-req").value, 0.6)));
  const kFactor = Math.max(0.5, num(el("kfactor").value, 4/3));
  const units = el("units").value;
  const successRule = el("success-rule").value || "margin";
  const heightSolve = el("height-solve").value || "both";
  const antGainDb = getAntennaGainDb();

  return {
    freqMHz, txHeight_m, rxHeight_m,
    txPowerW, sysLossDb,
    rxSensDbm, fadeMarginDb,
    terrain, fresnelFactor, kFactor,
    units, successRule, heightSolve,
    antGainDb
  };
}

function getAntennaGainDb() {
  const v = el("antenna-preset").value;
  const presets = {
    hcdr_elev_3_5: 3.5,
    vhf_mono_2_5: 2.5,
    vhf_dipole_3_0: 3.0,
    ref_dipole_2_15: 2.15,
    ref_mono_5_15: 5.15,
  };
  if (v === "custom") return num(el("customGainDb").value, 3.0);
  return presets[v] ?? 3.0;
}

function num(v, fallback) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/* ===================== Loading UI ===================== */

function showLoading(on) {
  el("loading").classList.toggle("hidden", !on);
}

/* ===================== Elevation backends ===================== */

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchJsonWithRetries(url, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

// Bulk elevation: Open-Meteo first (100 coords/request), fallback to Open-Elevation POST
async function fetchElevations(locations) {
  if (!Array.isArray(locations) || locations.length === 0) return [];

  // --- 1) Open-Meteo Elevation API (best for grids/profiles) ---
  try {
    const results = [];
    const chunks = chunkArray(locations, 100); // up to 100 coords/request :contentReference[oaicite:3]{index=3}

    for (const ch of chunks) {
      const lats = ch.map(p => p.latitude).join(",");
      const lngs = ch.map(p => p.longitude).join(",");
      const url = `https://api.open-meteo.com/v1/elevation?latitude=${encodeURIComponent(lats)}&longitude=${encodeURIComponent(lngs)}`;
      const data = await fetchJsonWithRetries(url, 2);

      if (!data || !Array.isArray(data.elevation) || data.elevation.length !== ch.length) {
        throw new Error("Open-Meteo elevation shape mismatch");
      }

      for (let i = 0; i < ch.length; i++) {
        results.push({
          latitude: ch[i].latitude,
          longitude: ch[i].longitude,
          elevation: Number.isFinite(data.elevation[i]) ? data.elevation[i] : -9999
        });
      }
    }
    return results;
  } catch (e) {
    console.warn("Open-Meteo elevation failed; falling back to Open-Elevation:", e);
  }

  // --- 2) Fallback: Open-Elevation ---
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch("https://api.open-elevation.com/api/v1/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locations }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Open-Elevation HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.results)) throw new Error("Bad Open-Elevation response");

    return data.results.map(r => ({
      latitude: r.latitude,
      longitude: r.longitude,
      elevation: Number.isFinite(r.elevation) ? r.elevation : -9999
    }));
  } finally {
    clearTimeout(timer);
  }
}

async function fetchElevationProfileHardened(tx, rx, samples = 100) {
  const key = `${tx.lat.toFixed(6)},${tx.lng.toFixed(6)}|${rx.lat.toFixed(6)},${rx.lng.toFixed(6)}|${samples}`;
  if (state.profileCache.has(key)) return state.profileCache.get(key);

  const total_m = tx.distanceTo(rx);
  const locations = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    locations.push({
      latitude: tx.lat + (rx.lat - tx.lat) * t,
      longitude: tx.lng + (rx.lng - tx.lng) * t
    });
  }

  const elevs = await fetchWithRetries(async () => {
    const r = await fetchElevations(locations);
    if (!Array.isArray(r) || r.length !== locations.length) {
      throw new Error("Elevation batch mismatch");
    }
    return r;
  }, 2);

  const profile = elevs.map((r, i) => ({
    d_m: (i / samples) * total_m,
    h_m: Number.isFinite(r.elevation) ? r.elevation : 0
  }));

  state.profileCache.set(key, profile);
  return profile;
}

async function fetchWithRetries(fn, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; await sleep(350 * (i + 1)); }
  }
  throw lastErr;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ===================== RF math ===================== */

function fsplDb(distance_m, freqMHz) {
  const d_km = Math.max(distance_m / 1000, 0.001);
  return 32.44 + 20 * Math.log10(d_km) + 20 * Math.log10(freqMHz);
}

function wattsToDbm(watts) { return 10 * Math.log10(watts * 1000); }
function dbmToWatts(dbm) { return Math.pow(10, (dbm - 30) / 10); }

function minTxPowerWatts(totalLoss_dB, txGain_dBi, rxGain_dBi, rxSens_dBm, fadeMargin_dB) {
  const requiredTx_dBm = (rxSens_dBm + fadeMargin_dB) + totalLoss_dB - (txGain_dBi + rxGain_dBi);
  const requiredW = dbmToWatts(requiredTx_dBm);
  return { requiredTx_dBm, requiredW };
}

function terrainClutterLossDb(terrain) {
  switch (terrain) {
    case "open": return 0;
    case "hilly": return 10;
    case "urban": return 20;
    case "forest": return 25;
    default: return 0;
  }
}

function earthBulge_m(d1_m, d2_m, kFactor = 4/3) {
  const Re = 6371000;
  const Re_eff = Re * kFactor;
  return (d1_m * d2_m) / (2 * Re_eff);
}

function knifeEdgeLoss_dB(v) {
  if (v <= -0.78) return 0;
  return 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1);
}

function maxKnifeEdgeDiffraction(profile, freqMHz, txHeight_m, rxHeight_m, kFactor = 4/3) {
  const λ = 300 / freqMHz;
  const D = profile.at(-1).d_m;

  const txAgl = profile[0].h_m + txHeight_m;
  const rxAgl = profile.at(-1).h_m + rxHeight_m;

  let maxV = -Infinity;
  let worstIndex = 1;

  for (let i = 1; i < profile.length - 1; i++) {
    const d1 = profile[i].d_m;
    const d2 = D - d1;

    const bulge = earthBulge_m(d1, d2, kFactor);
    const los = txAgl + (rxAgl - txAgl) * (d1 / D);
    const terrainEff = profile[i].h_m + bulge;
    const h_obst = terrainEff - los;

    const v = h_obst * Math.sqrt((2 * (d1 + d2)) / (λ * d1 * d2));
    if (v > maxV) { maxV = v; worstIndex = i; }
  }

  const loss_dB = knifeEdgeLoss_dB(maxV);

  const d1 = profile[worstIndex].d_m;
  const d2 = D - d1;
  const bulge_m = earthBulge_m(d1, d2, kFactor);

  const losAtWorst = txAgl + (rxAgl - txAgl) * (d1 / D);
  const obst_m = (profile[worstIndex].h_m + bulge_m) - losAtWorst;

  return {
    loss_dB,
    maxV,
    worstIndex,
    worstAt_km: d1 / 1000,
    bulge_m,
    obst_m
  };
}

function fresnelClearance(profile, freqMHz, txHeight_m, rxHeight_m, kFactor, fresnelFactor) {
  const λ = 300 / freqMHz;
  const D = profile.at(-1).d_m;

  const txAgl = profile[0].h_m + txHeight_m;
  const rxAgl = profile.at(-1).h_m + rxHeight_m;

  let worstClear_m = Infinity;
  let worstAt_m = 0;
  let worstIndex = 1;
  let maxBulge = 0;

  for (let i = 1; i < profile.length - 1; i++) {
    const d1 = profile[i].d_m;
    const d2 = D - d1;

    const r1 = Math.sqrt((λ * d1 * d2) / D);
    const bulge = earthBulge_m(d1, d2, kFactor);
    maxBulge = Math.max(maxBulge, bulge);

    const los = txAgl + (rxAgl - txAgl) * (d1 / D);
    const terrainEff = profile[i].h_m + bulge;

    const clear_m = los - terrainEff - fresnelFactor * r1;

    if (clear_m < worstClear_m) {
      worstClear_m = clear_m;
      worstAt_m = d1;
      worstIndex = i;
    }
  }

  return {
    worstClear_m,
    worstAt_km: worstAt_m / 1000,
    worstAt_m,
    worstIndex,
    maxBulge_m: maxBulge
  };
}

function classifyLink(marginDb) {
  if (marginDb >= 20) return { label: "GOOD", color: "#00ff66" };
  if (marginDb >= 10) return { label: "MARGINAL", color: "#ffaa00" };
  return { label: "POOR", color: "#ff3344" };
}

function classifyByRule(rule, marginDb, fresnelPass) {
  if (rule === "margin_fresnel") {
    return { ok: marginDb >= 0 && fresnelPass, why: (marginDb < 0 ? "Margin<0" : "Fresnel blocked") };
  }
  return { ok: marginDb >= 0, why: "Margin<0" };
}

/* ===== Min height solver modes (capped at 11.4m) ===== */

function minExtraHeightForFresnel(profile, freqMHz, txHeight_m, rxHeight_m, kFactor, fresnelFactor, mode = "both") {
  const MAX_MAST = 11.4;
  const MAX_EXTRA = 11.4;
  let lo = 0, hi = MAX_EXTRA;
  let best = null;

  const evalWithExtra = (extra) => {
    let txH = txHeight_m;
    let rxH = rxHeight_m;

    if (mode === "both") { txH += extra; rxH += extra; }
    else if (mode === "tx") txH += extra;
    else if (mode === "rx") rxH += extra;
    else if (mode === "taller") {
      if (txH >= rxH) txH += extra;
      else rxH += extra;
    }

    txH = Math.min(txH, MAX_MAST);
    rxH = Math.min(rxH, MAX_MAST);

    const fr = fresnelClearance(profile, freqMHz, txH, rxH, kFactor, fresnelFactor);
    return { fr, txH, rxH };
  };

  const base = evalWithExtra(0);
  if (base.fr.worstClear_m >= 0) {
    return { extra_m: 0, achieved: base.fr, txH: base.txH, rxH: base.rxH };
  }

  for (let iter = 0; iter < 30; iter++) {
    const mid = (lo + hi) / 2;
    const r = evalWithExtra(mid);

    if (r.fr.worstClear_m >= 0) {
      best = { extra_m: mid, achieved: r.fr, txH: r.txH, rxH: r.rxH };
      hi = mid;
    } else {
      lo = mid;
    }
  }

  if (!best) {
    const capped = evalWithExtra(MAX_EXTRA);
    return { extra_m: null, achieved: capped.fr, txH: capped.txH, rxH: capped.rxH };
  }

  return best;
}

/* ===================== Analysis: direct / relay ===================== */

async function analyzePath() {
  if (!state.txMarker || !state.rxMarker) {
    hideCritical();
    return;
  }

  if (state.relay) {
    await analyzeViaRelay();
    return;
  }

  await analyzeDirect();
}

async function analyzeDirect() {
  showLoading(true);
  try {
    const inputs = readInputs();
    const tx = state.txMarker.getLatLng();
    const rx = state.rxMarker.getLatLng();

    const profile = await fetchElevationProfileHardened(tx, rx, 110);

    const fspl = fsplDb(profile.at(-1).d_m, inputs.freqMHz);
    const clutterLoss = terrainClutterLossDb(inputs.terrain);
    const diff = maxKnifeEdgeDiffraction(profile, inputs.freqMHz, inputs.txHeight_m, inputs.rxHeight_m, inputs.kFactor);
    const fr = fresnelClearance(profile, inputs.freqMHz, inputs.txHeight_m, inputs.rxHeight_m, inputs.kFactor, inputs.fresnelFactor);

    const totalLoss = fspl + clutterLoss + diff.loss_dB + inputs.sysLossDb;

    const tx_dBm = wattsToDbm(inputs.txPowerW);
    const rx_dBm = tx_dBm + inputs.antGainDb + inputs.antGainDb - totalLoss;

    const threshold = inputs.rxSensDbm + inputs.fadeMarginDb;
    const margin_dB = rx_dBm - threshold;

    const fresnelPass = fr.worstClear_m >= 0;
    const success = classifyByRule(inputs.successRule, margin_dB, fresnelPass);
    const cls = classifyLink(success.ok ? margin_dB : -999);

    drawDirectLine(tx, rx, cls.color);

    setFresnelMarker(tx, rx, fr, profile);
    setDiffractionMarker(tx, rx, diff, profile);

    renderCritical({
      inputs, tx, rx,
      fspl, clutterLoss, diff, fr,
      totalLoss, tx_dBm, rx_dBm,
      threshold, margin_dB,
      success, cls,
      minP: minTxPowerWatts(totalLoss, inputs.antGainDb, inputs.antGainDb, inputs.rxSensDbm, inputs.fadeMarginDb),
      minH: minExtraHeightForFresnel(profile, inputs.freqMHz, inputs.txHeight_m, inputs.rxHeight_m, inputs.kFactor, inputs.fresnelFactor, inputs.heightSolve),
    });

    drawElevationChart(profile, inputs, fr, diff);

    document.querySelector(".chart-wrap")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => state.map.invalidateSize(), 50);

  } finally {
    showLoading(false);
  }
}

function analyzeSingleLeg(A, B, profile, inputs) {
  const fspl = fsplDb(profile.at(-1).d_m, inputs.freqMHz);
  const clutterLoss = terrainClutterLossDb(inputs.terrain);
  const diff = maxKnifeEdgeDiffraction(profile, inputs.freqMHz, inputs.txHeight_m, inputs.rxHeight_m, inputs.kFactor);
  const fr = fresnelClearance(profile, inputs.freqMHz, inputs.txHeight_m, inputs.rxHeight_m, inputs.kFactor, inputs.fresnelFactor);

  const totalLoss = fspl + clutterLoss + diff.loss_dB + inputs.sysLossDb;

  const tx_dBm = wattsToDbm(inputs.txPowerW);
  const rx_dBm = tx_dBm + inputs.antGainDb + inputs.antGainDb - totalLoss;

  const threshold = inputs.rxSensDbm + inputs.fadeMarginDb;
  const margin_dB = rx_dBm - threshold;

  const fresnelPass = fr.worstClear_m >= 0;
  const success = classifyByRule(inputs.successRule, margin_dB, fresnelPass);

  const minP = minTxPowerWatts(totalLoss, inputs.antGainDb, inputs.antGainDb, inputs.rxSensDbm, inputs.fadeMarginDb);
  const minH = minExtraHeightForFresnel(profile, inputs.freqMHz, inputs.txHeight_m, inputs.rxHeight_m, inputs.kFactor, inputs.fresnelFactor, inputs.heightSolve);

  return {
    fspl, clutterLoss, diff, fr,
    totalLoss, tx_dBm, rx_dBm, threshold, margin_dB,
    fresnelPass, success,
    minP, minH,
    distance_km: profile.at(-1).d_m / 1000,
    profile
  };
}

async function analyzeDirectSummary(tx, rx, inputs) {
  const profile = await fetchElevationProfileHardened(tx, rx, 110);
  return analyzeSingleLeg(tx, rx, profile, inputs);
}

async function analyzeViaRelay() {
  showLoading(true);
  try {
    const inputs = readInputs();
    const tx = state.txMarker.getLatLng();
    const rx = state.rxMarker.getLatLng();
    const r  = state.relay.latlng;

    const p1 = await fetchElevationProfileHardened(tx, r, 100);
    const p2 = await fetchElevationProfileHardened(r, rx, 100);

    const a1 = analyzeSingleLeg(tx, r, p1, inputs);
    const a2 = analyzeSingleLeg(r, rx, p2, inputs);

    state.relayPathLines.forEach(l => state.map.removeLayer(l));
    state.relayPathLines = [];

    clearDirectDrawing();
    clearAnalysisMarkers();

    const c1 = classifyLink(a1.success.ok ? a1.margin_dB : -999).color;
    const c2 = classifyLink(a2.success.ok ? a2.margin_dB : -999).color;

    state.relayPathLines.push(drawLegLine(tx, r, c1));
    state.relayPathLines.push(drawLegLine(r, rx, c2));

    await renderRelayCriticalCompare({ tx, rx, relayLatLng: r, a1, a2, inputs });

    const worst = a1.margin_dB <= a2.margin_dB ? a1 : a2;
    drawElevationChart(worst.profile, inputs, worst.fr, worst.diff);

    document.querySelector(".chart-wrap")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => state.map.invalidateSize(), 50);

  } finally {
    showLoading(false);
  }
}

/* ===================== Critical box renderers ===================== */

function renderCritical(r) {
  const crit = el("critical");
  crit.classList.remove("hidden", "good", "marginal", "poor");

  if (r.cls.label === "GOOD") crit.classList.add("good");
  else if (r.cls.label === "MARGINAL") crit.classList.add("marginal");
  else crit.classList.add("poor");

  const units = el("units").value;
  const D_m = r.tx.distanceTo(r.rx);

  const distText = units === "imperial"
    ? `${(D_m / 1609.344).toFixed(2)} mi`
    : `${(D_m / 1000).toFixed(2)} km`;

  const heightUnit = units === "imperial" ? "ft" : "m";
  const toFeet = (m) => m * 3.28084;

  const frStatus = r.fr.worstClear_m >= 0 ? "PASS" : "FAIL";
  const ruleText = r.inputs.successRule === "margin_fresnel" ? "Margin + Fresnel" : "Margin only";

  const minPText = r.minP.requiredW < 1000 ? `${r.minP.requiredW.toFixed(2)} W` : `${(r.minP.requiredW/1000).toFixed(2)} kW`;

  let minHeightText;
  if (r.minH.extra_m == null) minHeightText = `Not achievable within 11.4 m mast limit`;
  else {
    const extra = units === "imperial" ? toFeet(r.minH.extra_m) : r.minH.extra_m;
    const txH = units === "imperial" ? toFeet(r.minH.txH) : r.minH.txH;
    const rxH = units === "imperial" ? toFeet(r.minH.rxH) : r.minH.rxH;
    minHeightText = `+${extra.toFixed(1)} ${heightUnit} (Tx ${txH.toFixed(1)} / Rx ${rxH.toFixed(1)})`;
  }

  crit.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
      <div style="font-weight:900;font-size:1.05rem;">Link Summary</div>
      <div style="font-weight:1000;color:${r.cls.color};">${r.cls.label}</div>
    </div>

    <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div><strong>Distance:</strong> ${distText}</div>
      <div><strong>Bearing:</strong> ${bearingDeg(r.tx, r.rx).toFixed(0)}°</div>

      <div><strong>FSPL:</strong> ${r.fspl.toFixed(1)} dB</div>
      <div><strong>Knife-edge:</strong> ${r.diff.loss_dB.toFixed(1)} dB (v=${r.diff.maxV.toFixed(2)})</div>

      <div><strong>Clutter:</strong> ${r.clutterLoss.toFixed(1)} dB</div>
      <div><strong>System loss:</strong> ${r.inputs.sysLossDb.toFixed(1)} dB</div>

      <div><strong>Total loss:</strong> ${r.totalLoss.toFixed(1)} dB</div>
      <div><strong>Rule:</strong> ${ruleText}</div>

      <div><strong>Tx:</strong> ${r.inputs.txPowerW} W (${r.tx_dBm.toFixed(1)} dBm)</div>
      <div><strong>Rx:</strong> ${r.rx_dBm.toFixed(1)} dBm</div>

      <div><strong>Sens + Fade:</strong> ${r.threshold.toFixed(1)} dBm</div>
      <div><strong>Margin:</strong> ${r.margin_dB.toFixed(1)} dB</div>

      <div style="grid-column:1 / -1;">
        <strong>Fresnel:</strong> ${Math.round(r.inputs.fresnelFactor*100)}% •
        worst <b>${r.fr.worstClear_m.toFixed(1)} m</b> (${frStatus}) •
        at <b>${r.fr.worstAt_km.toFixed(2)} km</b> • bulge max <b>${r.fr.maxBulge_m.toFixed(1)} m</b>
      </div>

      <div style="grid-column:1 / -1;">
        <strong>Min Tx power (margin≥0):</strong> <b>${minPText}</b> (${r.minP.requiredTx_dBm.toFixed(1)} dBm)
      </div>

      <div style="grid-column:1 / -1;">
        <strong>Min extra height (Fresnel pass):</strong> <b>${minHeightText}</b>
      </div>
    </div>
  `;
}

async function renderRelayCriticalCompare({ tx, rx, relayLatLng, a1, a2, inputs }) {
  const direct = await analyzeDirectSummary(tx, rx, inputs);

  const relayBottleneck = Math.min(a1.success.ok ? a1.margin_dB : -999, a2.success.ok ? a2.margin_dB : -999);
  const relayCls = classifyLink(relayBottleneck);

  const directScore = direct.success.ok ? direct.margin_dB : -999;
  const directCls = classifyLink(directScore);

  const c = el("critical");
  c.classList.remove("hidden", "good", "marginal", "poor");
  c.classList.add(relayCls.label === "GOOD" ? "good" : relayCls.label === "MARGINAL" ? "marginal" : "poor");

  const minHText = (mh) => mh.extra_m == null ? "Not achievable ≤11.4 m" : `+${mh.extra_m.toFixed(1)} m`;
  const minPText = (mp) => mp.requiredW < 1000 ? `${mp.requiredW.toFixed(2)} W` : `${(mp.requiredW/1000).toFixed(2)} kW`;

  const ruleName = inputs.successRule === "margin_fresnel" ? "Margin + Fresnel" : "Margin only";

  c.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
      <div style="font-weight:900;font-size:1.05rem;">Direct vs Relay (${ruleName})</div>
      <div style="font-weight:1000;color:${relayCls.color};">RELAY ${relayCls.label}</div>
    </div>

    <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div style="padding:10px;border:1px solid rgba(255,255,255,0.10);border-radius:12px;background:rgba(13,17,23,0.55);">
        <div style="font-weight:900;margin-bottom:6px;">Direct</div>
        <div>Status: <b style="color:${directCls.color}">${direct.success.ok ? directCls.label : "POOR"}</b></div>
        <div>Margin: <b>${direct.margin_dB.toFixed(1)} dB</b></div>
        <div>Fresnel: <b>${direct.fr.worstClear_m >= 0 ? "PASS" : "FAIL"}</b></div>
        <div>Min Tx power: <b>${minPText(direct.minP)}</b></div>
        <div>Min extra height: <b>${minHText(direct.minH)}</b></div>
      </div>

      <div style="padding:10px;border:1px solid rgba(255,255,255,0.10);border-radius:12px;background:rgba(13,17,23,0.55);">
        <div style="font-weight:900;margin-bottom:6px;">Relay (2 legs)</div>
        <div>Status: <b style="color:${relayCls.color}">${relayCls.label}</b></div>
        <div>Bottleneck margin: <b>${relayBottleneck.toFixed(1)} dB</b></div>
        <div>Min Tx power (leg1/leg2): <b>${minPText(a1.minP)}</b> / <b>${minPText(a2.minP)}</b></div>
        <div>Min extra height (leg1/leg2): <b>${minHText(a1.minH)}</b> / <b>${minHText(a2.minH)}</b></div>
      </div>

      <div style="grid-column:1 / -1;">
        <b>Tx→Relay</b> ${a1.distance_km.toFixed(2)} km • margin ${a1.margin_dB.toFixed(1)} dB • Fresnel ${a1.fr.worstClear_m>=0?"PASS":"FAIL"}
        <br>
        <b>Relay→Rx</b> ${a2.distance_km.toFixed(2)} km • margin ${a2.margin_dB.toFixed(1)} dB • Fresnel ${a2.fr.worstClear_m>=0?"PASS":"FAIL"}
      </div>

      <div style="grid-column:1 / -1;opacity:0.95;">
        <button id="toggle-relay-btn" class="secondary" style="margin-top:6px;">Clear Relay (back to direct)</button>
      </div>
    </div>
  `;

  document.getElementById("toggle-relay-btn")?.addEventListener("click", () => {
    clearRelay();
    analyzePath();
  });
}

function hideCritical() {
  const c = el("critical");
  c.classList.add("hidden");
  c.classList.remove("good", "marginal", "poor");
  c.innerHTML = "";
}

/* ===================== Chart ===================== */

function drawElevationChart(profile, inputs, fr, diff) {
  const ctx = el("elevation-profile").getContext("2d");
  if (state.chart) state.chart.destroy();

  const labels = profile.map(p => (p.d_m / 1000).toFixed(1));
  const series = buildLosAndFresnelSeries(
    profile, inputs.freqMHz, inputs.txHeight_m, inputs.rxHeight_m, inputs.kFactor, inputs.fresnelFactor
  );

  state.chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Terrain (effective)", data: series.terrainEff, borderWidth: 1, pointRadius: 0, tension: 0.25 },
        { label: "Terrain", data: series.terrainRaw, borderWidth: 2, pointRadius: 0, tension: 0.25 },
        { label: "Fresnel lower", data: series.fresnelLower, borderWidth: 1, pointRadius: 0, tension: 0.15 },
        { label: "Fresnel upper", data: series.fresnelUpper, borderWidth: 1, pointRadius: 0, tension: 0.15, fill: "-1" },
        { label: "LOS", data: series.los, borderWidth: 2, pointRadius: 0, tension: 0.15 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: {
        x: { ticks: { maxTicksLimit: 8 }, title: { display: true, text: "Distance (km)" } },
        y: { ticks: { maxTicksLimit: 6 }, title: { display: true, text: "Elevation (m)" } }
      }
    }
  });
}

function buildLosAndFresnelSeries(profile, freqMHz, txHeight_m, rxHeight_m, kFactor, fresnelFactor) {
  const λ = 300 / freqMHz;
  const D = profile.at(-1).d_m;

  const txAgl = profile[0].h_m + txHeight_m;
  const rxAgl = profile.at(-1).h_m + rxHeight_m;

  const terrainRaw = [];
  const terrainEff = [];
  const los = [];
  const fresnelUpper = [];
  const fresnelLower = [];

  for (let i = 0; i < profile.length; i++) {
    const d1 = profile[i].d_m;
    const d2 = Math.max(0, D - d1);

    const bulge = earthBulge_m(d1, d2, kFactor);
    const te = profile[i].h_m + bulge;

    const losH = txAgl + (rxAgl - txAgl) * (d1 / D);
    const r1 = Math.sqrt((λ * d1 * d2) / D);
    const rReq = fresnelFactor * r1;

    terrainRaw.push(profile[i].h_m);
    terrainEff.push(te);
    los.push(losH);
    fresnelUpper.push(losH + rReq);
    fresnelLower.push(losH - rReq);
  }

  return { terrainRaw, terrainEff, los, fresnelUpper, fresnelLower };
}

/* ===================== Worst-point markers ===================== */

function setFresnelMarker(tx, rx, fr, profile) {
  if (state.fresnelMarker) state.map.removeLayer(state.fresnelMarker);

  const t = profile[fr.worstIndex].d_m / profile.at(-1).d_m;
  const lat = tx.lat + (rx.lat - tx.lat) * t;
  const lng = tx.lng + (rx.lng - tx.lng) * t;

  state.fresnelMarker = L.circleMarker([lat, lng], {
    radius: 8,
    color: "#ffd400",
    weight: 3,
    fillColor: "#ffd400",
    fillOpacity: 0.95
  }).addTo(state.map);

  const status = fr.worstClear_m >= 0 ? "Pass" : "Fail";
  state.fresnelMarker.bindPopup(
    `<b>Worst Fresnel Point</b><br>` +
    `Status: <b>${status}</b><br>` +
    `Clearance: <b>${fr.worstClear_m.toFixed(1)} m</b><br>` +
    `At: <b>${fr.worstAt_km.toFixed(2)} km</b>`
  );
}

function setDiffractionMarker(tx, rx, diff, profile) {
  if (state.diffMarker) state.map.removeLayer(state.diffMarker);

  const t = profile[diff.worstIndex].d_m / profile.at(-1).d_m;
  const lat = tx.lat + (rx.lat - tx.lat) * t;
  const lng = tx.lng + (rx.lng - tx.lng) * t;

  state.diffMarker = L.circleMarker([lat, lng], {
    radius: 8,
    color: "#ff4d6d",
    weight: 3,
    fillColor: "#ff4d6d",
    fillOpacity: 0.95
  }).addTo(state.map);

  state.diffMarker.bindPopup(
    `<b>Worst Knife-Edge</b><br>` +
    `v: <b>${diff.maxV.toFixed(2)}</b><br>` +
    `Diff loss: <b>${diff.loss_dB.toFixed(1)} dB</b><br>` +
    `Obstruction: <b>${diff.obst_m.toFixed(1)} m</b><br>` +
    `Bulge: <b>${diff.bulge_m.toFixed(1)} m</b><br>` +
    `At: <b>${diff.worstAt_km.toFixed(2)} km</b>`
  );
}

/* ===================== Map cursor readout ===================== */

function enableMapReadout() {
  const box = document.getElementById("map-readout");
  if (!box) return;

  let lastUI = 0;
  let pending = null;

  state.map.on("mousemove", (e) => {
    const now = Date.now();
    if (now - lastUI < 180) return;
    lastUI = now;

    const p = e.latlng;
    const grid = isInUK(p) ? toBNG(p, 10) : toMGRS(p, 5);
    box.textContent = `${grid} • ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} • elev…`;

    if (pending) return;
    pending = setTimeout(async () => {
      pending = null;
      try {
        const elev = await fetchElevationSingleCached(p.lat, p.lng);
        box.textContent = `${grid} • ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} • ${Math.round(elev)} m`;
      } catch {
        box.textContent = `${grid} • ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} • elev ?`;
      }
    }, 650);
  });
}

async function fetchElevationSingleCached(lat, lng) {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (state.pointElevCache.has(key)) return state.pointElevCache.get(key);

  const res = await fetchElevations([{ latitude: lat, longitude: lng }]);
  const elev = res?.[0]?.elevation ?? 0;
  state.pointElevCache.set(key, elev);
  return elev;
}

/* ===================== High points in view (zoom adaptive) ===================== */

function clearHighPoints() {
  state.highPointsLayer.clearLayers();
}

async function showHighPointsInView() {
  if (!state.map) return;

  showLoading(true);
  try {
    clearHighPoints();

    const b = state.map.getBounds();
    const south = b.getSouth(), north = b.getNorth();
    const west = b.getWest(), east = b.getEast();

    const zoom = state.map.getZoom();

    // zoom adaptive grid: fewer points when zoomed out (huge areas)
    const nx =
      zoom >= 13 ? 28 :
      zoom >= 11 ? 22 :
      zoom >= 9  ? 16 : 12;
    const ny = nx;

    const coarseLocations = buildGridLocations(south, north, west, east, nx, ny);
    const coarse = await fetchElevations(coarseLocations);
    coarse.sort((a, c) => c.elevation - a.elevation);

    // fewer candidates (reduces refine load) + reduces clustering on same ridge
    const candidates = coarse.slice(0, Math.min(10, coarse.length)); // was 18

    // refine radius based on zoom
    const refineRadiusM =
      zoom >= 13 ? 250 :
      zoom >= 11 ? 450 :
      zoom >= 9  ? 800 : 1200;

    const refineNx = 5, refineNy = 5;

    const refineLocations = [];
    for (const c of candidates) {
      const { dLat, dLng } = metersToLatLngDeltas(c.latitude, c.longitude, refineRadiusM);
      refineLocations.push(...buildGridLocations(
        c.latitude - dLat, c.latitude + dLat,
        c.longitude - dLng, c.longitude + dLng,
        refineNx, refineNy
      ));
    }

    const refined = await fetchElevations(refineLocations);

    const merged = dedupeByApproxLatLng([...coarse, ...refined], 5);
    merged.sort((a, c) => c.elevation - a.elevation);

    // spacing based on viewport size (much better than fixed 500m / zoom-only)
    const diagonalM = state.map.distance(b.getSouthWest(), b.getNorthEast());

    // target ~ 1/10 of diagonal, clamped to sensible range
    let minSpacingM = diagonalM / 10;
    minSpacingM = Math.max(1500, Math.min(minSpacingM, 8000)); // 1.5–8 km

    // pick top 10 using "one-per-cell" to prevent bunching
    let top = selectTopOnePerCell(merged, 10, minSpacingM);

    // fallback if we couldn't fill 10 (rare)
    if (top.length < 10) top = selectTopWithMinSpacing(merged, 10, minSpacingM);
    if (top.length < 10) top = merged.slice(0, 10);

    top.forEach((p, idx) => {
      const icon = L.divIcon({
        className: "high-point-icon",
        html: "▲",
        iconSize: [28, 28],
        iconAnchor: [14, 28],
      });

      const m = L.marker([p.latitude, p.longitude], { icon })
        .bindPopup(
          `<b>High Point #${idx + 1}</b><br>` +
          `Elev: <b>${Math.round(p.elevation)} m</b><br>` +
          `Lat/Lng: ${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`
        );

      m.addTo(state.highPointsLayer);
    });

    state.highPointsLayer.addTo(state.map);
  } catch (e) {
    console.error(e);
    alert("High points lookup failed (DEM service busy). Try zooming in or try again.");
  } finally {
    showLoading(false);
  }
}

function buildGridLocations(south, north, west, east, nx, ny) {
  const locs = [];
  for (let iy = 0; iy < ny; iy++) {
    const tY = ny === 1 ? 0.5 : iy / (ny - 1);
    const lat = south + (north - south) * tY;
    for (let ix = 0; ix < nx; ix++) {
      const tX = nx === 1 ? 0.5 : ix / (nx - 1);
      const lng = west + (east - west) * tX;
      locs.push({ latitude: lat, longitude: lng });
    }
  }
  return locs;
}

function metersToLatLngDeltas(latDeg, lonDeg, meters) {
  const latRad = latDeg * Math.PI / 180;
  const dLat = meters / 111320;
  const dLng = meters / (111320 * Math.cos(latRad));
  return { dLat, dLng };
}

function dedupeByApproxLatLng(points, decimals = 5) {
  const m = new Map();
  const f = Math.pow(10, decimals);
  for (const p of points) {
    const key = `${Math.round(p.latitude * f) / f},${Math.round(p.longitude * f) / f}`;
    const prev = m.get(key);
    if (!prev || p.elevation > prev.elevation) m.set(key, p);
  }
  return [...m.values()];
}

function selectTopWithMinSpacing(points, count, minSpacingM) {
  const chosen = [];
  for (const p of points) {
    let ok = true;
    for (const c of chosen) {
      if (haversineMeters(p.latitude, p.longitude, c.latitude, c.longitude) < minSpacingM) {
        ok = false;
        break;
      }
    }
    if (ok) chosen.push(p);
    if (chosen.length >= count) break;
  }
  return chosen;
}

// NEW: strong de-clustering — allow only one selected point per "cell"
function selectTopOnePerCell(points, count, cellSizeM) {
  const picked = [];
  const used = new Set();

  for (const p of points) {
    if (picked.length >= count) break;
    const key = cellKey(p.latitude, p.longitude, cellSizeM);
    if (used.has(key)) continue;
    used.add(key);
    picked.push(p);
  }
  return picked;
}

function cellKey(lat, lng, cellSizeM) {
  const latRad = lat * Math.PI / 180;
  const dLat = cellSizeM / 111320;
  const dLng = cellSizeM / (111320 * Math.cos(latRad));
  const iy = Math.floor(lat / dLat);
  const ix = Math.floor(lng / dLng);
  return `${ix}:${iy}`;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function buildCorridorSamples(tx, rx, alongSteps, acrossSteps, halfWidthM) {
  const midLat = (tx.lat + rx.lat) / 2;
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(midLat * Math.PI / 180);

  const dx = (rx.lng - tx.lng) * metersPerDegLng;
  const dy = (rx.lat - tx.lat) * metersPerDegLat;
  const Lm = Math.hypot(dx, dy) || 1;

  const ux = dx / Lm;
  const uy = dy / Lm;

  // perpendicular unit vector
  const px = -uy;
  const py = ux;

  const points = [];

  for (let i = 0; i <= alongSteps; i++) {
    const t = i / alongSteps;
    const baseLat = tx.lat + (rx.lat - tx.lat) * t;
    const baseLng = tx.lng + (rx.lng - tx.lng) * t;

    for (let j = 0; j < acrossSteps; j++) {
      const a = acrossSteps === 1 ? 0 : (j / (acrossSteps - 1)) * 2 - 1;
      const offsetM = a * halfWidthM;

      const offLng = baseLng + (px * offsetM) / metersPerDegLng;
      const offLat = baseLat + (py * offsetM) / metersPerDegLat;

      points.push({ lat: offLat, lng: offLng });
    }
  }
  return points;
}

function selectRelayWithSpacing(scored, count, minSpacingM) {
  const chosen = [];

  for (const s of scored) {
    let ok = true;
    for (const c of chosen) {
      if (state.map.distance(s.p, c.p) < minSpacingM) {
        ok = false;
        break;
      }
    }
    if (ok) chosen.push(s);
    if (chosen.length >= count) break;
  }
  return chosen;
}

function renderRelaySuggestions(list, tx, rx) {
  if (!state.relaySuggestLayer) {
    state.relaySuggestLayer = L.layerGroup().addTo(state.map);
  }
  state.relaySuggestLayer.clearLayers();

  const bothUK = isInUK(tx) && isInUK(rx);

  list.forEach((s, idx) => {
    const n = idx + 1;

    const m = L.circleMarker(s.p, {
      radius: 10,
      color: "#58a6ff",
      weight: 3,
      fillColor: "#58a6ff",
      fillOpacity: 0.85
    }).addTo(state.relaySuggestLayer);

    m.bindTooltip(String(n), { permanent: true, direction: "center" });

    const grid = bothUK && isInUK(s.p)
      ? toBNG(s.p, 10)
      : toMGRS(s.p, 5);

    m.bindPopup(
      `<b>Relay #${n}</b><br>
       ${grid}<br>
       Elevation: <b>${Math.round(s.elev)} m</b><br>
       Bottleneck margin: <b>${s.bottleneck.toFixed(1)} dB</b><br>
       Tx→R: ${s.seg1.margin_dB.toFixed(1)} dB<br>
       R→Rx: ${s.seg2.margin_dB.toFixed(1)} dB
       <hr>
       <button onclick="setRelayFromSuggestion(${s.p.lat}, ${s.p.lng})">
         Use as Relay
       </button>`
    );
  });
}

window.setRelayFromSuggestion = (lat, lng) => {
  setRelay(L.latLng(lat, lng));
};


/* ===================== Corridor scan relays ===================== */

/* ===================== Corridor scan relays (hardened) ===================== */

// NOTE: remove/avoid duplicates — keep ONLY this setLoadingText definition.
function setLoadingText(msg) {
  const box = document.getElementById("loading");
  if (!box) return;
  box.textContent = msg;
}

function withTimeout(promise, ms, label = "Operation") {
  return Promise.race([
    promise,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      out[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return out;
}

// UPDATED: allow profileSamples override for speed during relay scoring
async function quickEvaluateLink(a, b, inputs, profileSamples = 60) {
  const profile = await fetchElevationProfileHardened(a, b, profileSamples);

  const fspl = fsplDb(profile.at(-1).d_m, inputs.freqMHz);
  const clutter = terrainClutterLossDb(inputs.terrain);
  const diff = maxKnifeEdgeDiffraction(profile, inputs.freqMHz, inputs.txHeight_m, inputs.rxHeight_m, inputs.kFactor);

  const totalLoss = fspl + clutter + diff.loss_dB + inputs.sysLossDb;

  const tx_dBm = wattsToDbm(inputs.txPowerW);
  const rx_dBm = tx_dBm + inputs.antGainDb + inputs.antGainDb - totalLoss;

  const threshold = inputs.rxSensDbm + inputs.fadeMarginDb;
  const margin_dB = rx_dBm - threshold;

  return { margin_dB, rx_dBm, totalLoss, diffLoss: diff.loss_dB };
}

async function suggestRelaysCorridor() {
  if (!state.txMarker || !state.rxMarker) {
    alert("Place Tx and Rx first.");
    return;
  }

  showLoading(true);
  setLoadingText("Analysing… (building corridor)");

  try {
    const tx = state.txMarker.getLatLng();
    const rx = state.rxMarker.getLatLng();
    const inputs = readInputs();

    // ---- BOUNDED defaults (fast + reliable) ----
    const corridorHalfWidthM = 1200; // reduced
    const alongSteps = 26;          // reduced
    const acrossSteps = 5;          // reduced
    const candidatesToScore = 14;   // reduced
    const outputCount = 8;

    setLoadingText("Analysing… (sampling corridor elevations)");
    const corridorPts = buildCorridorSamples(tx, rx, alongSteps, acrossSteps, corridorHalfWidthM);

    // Elevation call with timeout
    const elevResRaw = await withTimeout(
      fetchElevations(corridorPts.map(p => ({ latitude: p.lat, longitude: p.lng }))),
      15000,
      "Corridor elevation"
    );

    // Accept array OR {results:[...]}
    const elevRes = Array.isArray(elevResRaw)
      ? elevResRaw
      : (Array.isArray(elevResRaw?.results) ? elevResRaw.results : null);

    if (!elevRes) throw new Error("fetchElevations() returned unexpected data shape");

    const elevations = elevRes
      .map(r => ({
        lat: r.latitude ?? r.lat,
        lng: r.longitude ?? r.lng,
        elev: r.elevation ?? r.elev
      }))
      .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(p.elev));

    // Filter out points too close to endpoints
    const filtered = elevations.filter(p => {
      const ll = L.latLng(p.lat, p.lng);
      return state.map.distance(tx, ll) > 300 && state.map.distance(rx, ll) > 300;
    });

    if (!filtered.length) throw new Error("No corridor samples after endpoint filtering");

    // Take top-by-elevation candidates (cheap heuristic)
    filtered.sort((a, b) => b.elev - a.elev);
    const candidates = filtered.slice(0, Math.min(candidatesToScore, filtered.length));

    // Score candidates: Tx→C and C→Rx
    setLoadingText(`Analysing… (scoring candidates 0/${candidates.length})`);

    const scored = await mapWithConcurrency(candidates, 3, async (c, i) => {
      setLoadingText(`Analysing… (scoring candidates ${i + 1}/${candidates.length})`);

      const p = L.latLng(c.lat, c.lng);
      const seg1 = await withTimeout(quickEvaluateLink(tx, p, inputs, 60), 12000, "Tx→Relay profile");
      const seg2 = await withTimeout(quickEvaluateLink(p, rx, inputs, 60), 12000, "Relay→Rx profile");

      const bottleneck = Math.min(seg1.margin_dB, seg2.margin_dB);
      return { p, elev: c.elev, bottleneck, seg1, seg2 };
    });

    const clean = scored.filter(Boolean);
    if (!clean.length) throw new Error("All candidate scoring failed");

    clean.sort((a, b) => (b.bottleneck - a.bottleneck) || (b.elev - a.elev));

    // spacing based on viewport diagonal (prevents clustering)
    const b = state.map.getBounds();
    const diagonalM = state.map.distance(b.getSouthWest(), b.getNorthEast());
    let minSpacingM = diagonalM / 12;
    minSpacingM = Math.max(1200, Math.min(minSpacingM, 7000));

    const top = selectRelayWithSpacing(clean, outputCount, minSpacingM);

    state.lastRelaySuggestions = top;
    renderRelaySuggestions(top, tx, rx);

    setLoadingText("Analysing… done");
  } catch (e) {
    console.error(e);
    // IMPORTANT: show the real reason, not just “DEM busy”
    alert(`Relay suggestion failed:\n${e?.message || e}`);
  } finally {
    showLoading(false);
  }
}

function useBestRelay() {
  if (!state.lastRelaySuggestions || state.lastRelaySuggestions.length === 0) {
    alert("Run Suggest Relays first.");
    return;
  }
  setRelay(state.lastRelaySuggestions[0].p);
}

// keep your existing buildCorridorSamples(), selectRelayWithSpacing(), renderRelaySuggestions()
// and window.setRelayFromSuggestion() below this line unchanged



/* ===================== Relay set/clear ===================== */

function setRelay(latlng) {
  clearRelay();

  const marker = L.circleMarker(latlng, {
    radius: 12,
    color: "#58a6ff",
    weight: 3,
    fillOpacity: 0.9
  }).addTo(state.map);

  marker.bindPopup("<b>Relay</b><br>(clear using button or via critical box)");
  state.relay = { latlng, marker };

  analyzePath();
}

function clearRelay() {
  if (state.relay?.marker) state.map.removeLayer(state.relay.marker);
  state.relay = null;

  state.relayPathLines.forEach(l => state.map.removeLayer(l));
  state.relayPathLines = [];
}

/* ===================== Copy / Save / Load ===================== */

async function copySummary() {
  const tx = state.txMarker ? state.txMarker.getLatLng() : null;
  const rx = state.rxMarker ? state.rxMarker.getLatLng() : null;
  if (!tx || !rx) { alert("Place Tx and Rx first."); return; }

  const bothUK = isInUK(tx) && isInUK(rx);
  const txStr = bothUK ? toBNG(tx, 10) : toMGRS(tx, 5);
  const rxStr = bothUK ? toBNG(rx, 10) : toMGRS(rx, 5);

  const relayStr = state.relay
    ? (bothUK && isInUK(state.relay.latlng) ? toBNG(state.relay.latlng, 10) : toMGRS(state.relay.latlng, 5))
    : "none";

  const txt = [
    "RF Path Analyser Summary",
    `Tx: ${txStr}`,
    `Rx: ${rxStr}`,
    `Relay: ${relayStr}`,
    `Distance: ${haversineKm(tx, rx).toFixed(2)} km`,
    `Bearing: ${bearingDeg(tx, rx).toFixed(0)}°`,
  ].join("\n");

  try {
    await navigator.clipboard.writeText(txt);
    alert("Copied summary to clipboard.");
  } catch {
    alert("Clipboard copy failed (browser permissions).");
  }
}

function buildProjectJSON() {
  const tx = state.txMarker ? state.txMarker.getLatLng() : null;
  const rx = state.rxMarker ? state.rxMarker.getLatLng() : null;

  return {
    version: 3,
    tx: tx ? { lat: tx.lat, lng: tx.lng } : null,
    rx: rx ? { lat: rx.lat, lng: rx.lng } : null,
    relay: state.relay ? { lat: state.relay.latlng.lat, lng: state.relay.latlng.lng } : null,
    inputs: {
      frequency: el("frequency").value,
      txHeight: el("txHeight").value,
      rxHeight: el("rxHeight").value,
      txPowerW: el("txPowerW").value,
      sysLossDb: el("sysLossDb").value,
      antennaPreset: el("antenna-preset").value,
      customGainDb: el("customGainDb").value,
      rxSensDbm: el("rxSensDbm").value,
      fadeMarginDb: el("fadeMarginDb").value,
      terrain: el("terrain-type").value,
      fresnelReq: el("fresnel-req").value,
      kfactor: el("kfactor").value,
      successRule: el("success-rule").value,
      heightSolve: el("height-solve").value,
      units: el("units").value
    }
  };
}

function applyProjectJSON(obj) {
  if (!obj || typeof obj !== "object") throw new Error("Invalid project JSON");

  if (obj.inputs) {
    el("frequency").value = obj.inputs.frequency ?? el("frequency").value;
    el("txHeight").value = obj.inputs.txHeight ?? el("txHeight").value;
    el("rxHeight").value = obj.inputs.rxHeight ?? el("rxHeight").value;
    el("txPowerW").value = obj.inputs.txPowerW ?? el("txPowerW").value;
    el("sysLossDb").value = obj.inputs.sysLossDb ?? el("sysLossDb").value;

    el("antenna-preset").value = obj.inputs.antennaPreset ?? el("antenna-preset").value;
    el("customGainDb").value = obj.inputs.customGainDb ?? el("customGainDb").value;

    el("rxSensDbm").value = obj.inputs.rxSensDbm ?? el("rxSensDbm").value;
    el("fadeMarginDb").value = obj.inputs.fadeMarginDb ?? el("fadeMarginDb").value;
    el("terrain-type").value = obj.inputs.terrain ?? el("terrain-type").value;
    el("fresnel-req").value = obj.inputs.fresnelReq ?? el("fresnel-req").value;
    el("kfactor").value = obj.inputs.kfactor ?? el("kfactor").value;
    el("success-rule").value = obj.inputs.successRule ?? el("success-rule").value;
    el("height-solve").value = obj.inputs.heightSolve ?? el("height-solve").value;
    el("units").value = obj.inputs.units ?? el("units").value;
  }

  updateAntennaUI();

  clearAnalysisMarkers();
  clearDirectDrawing();
  clearRelay();

  if (obj.tx) setMarker("tx", L.latLng(obj.tx.lat, obj.tx.lng));
  if (obj.rx) setMarker("rx", L.latLng(obj.rx.lat, obj.rx.lng));

  if (obj.relay && obj.tx && obj.rx) {
    setRelay(L.latLng(obj.relay.lat, obj.relay.lng));
  } else {
    updateSummary();
    analyzePath();
  }

  if (state.txMarker && state.rxMarker) {
    const b = L.latLngBounds([state.txMarker.getLatLng(), state.rxMarker.getLatLng()]);
    state.map.fitBounds(b.pad(0.25));
  }
}

function saveProject() {
  const data = buildProjectJSON();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `rf-path-project-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function loadProjectFromFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      applyProjectJSON(obj);
      alert("Project loaded.");
    } catch (err) {
      console.error(err);
      alert("Failed to load project JSON.");
    } finally {
      el("load-file").value = "";
    }
  };
  reader.readAsText(file);
}

/* ===================== Geometry ===================== */

function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function bearingDeg(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) *
    Math.cos(toRad(b.lng - a.lng));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function toRad(d) { return d * Math.PI / 180; }

function isInUK(latlng) {
  return (latlng.lat >= 49.8 && latlng.lat <= 60.95 && latlng.lng >= -8.7 && latlng.lng <= 1.95);
}

/* ===================== BNG + MGRS ===================== */

// ===================== BNG (British National Grid) =====================
// WGS84 lat/lng -> OSGB36 Easting/Northing -> grid ref
// Returns e.g. "SU 12345 67890" (10 digits) or fewer depending on digits.

function toBNG(latlng, digits = 10) {
  const lat = latlng.lat;
  const lon = latlng.lng;

  const en = wgs84ToOsgb36EN(lat, lon);
  if (!en) return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

  return osGridRefFromEN(en.E, en.N, digits);
}

function wgs84ToOsgb36EN(latDeg, lonDeg) {
  // Convert WGS84 lat/lon to cartesian (WGS84)
  const a1 = 6378137.0;
  const b1 = 6356752.3141;
  const e2_1 = (a1*a1 - b1*b1) / (a1*a1);

  const φ = degToRad(latDeg);
  const λ = degToRad(lonDeg);
  const sinφ = Math.sin(φ), cosφ = Math.cos(φ);

  const ν1 = a1 / Math.sqrt(1 - e2_1 * sinφ*sinφ);
  const H = 0;

  let x1 = (ν1 + H) * cosφ * Math.cos(λ);
  let y1 = (ν1 + H) * cosφ * Math.sin(λ);
  let z1 = ((1 - e2_1) * ν1 + H) * sinφ;

  // Helmert transform WGS84 -> OSGB36 (approx; standard params)
  // translations (m)
  const tx = -446.448;
  const ty = 125.157;
  const tz = -542.060;

  // rotations (arcseconds -> radians)
  const rx = degToRad(0.0) + ( -0.1502 / 3600 ) * Math.PI/180;
  const ry = degToRad(0.0) + ( -0.2470 / 3600 ) * Math.PI/180;
  const rz = degToRad(0.0) + ( -0.8421 / 3600 ) * Math.PI/180;

  // scale (ppm -> unitless)
  const s = 20.4894 * 1e-6;

  const x2 = tx + (1 + s) * x1 + (-rz) * y1 + (ry) * z1;
  const y2 = ty + (rz) * x1 + (1 + s) * y1 + (-rx) * z1;
  const z2 = tz + (-ry) * x1 + (rx) * y1 + (1 + s) * z1;

  // Convert cartesian (OSGB36) -> lat/lon on Airy 1830
  const a2 = 6377563.396;
  const b2 = 6356256.909;
  const e2_2 = (a2*a2 - b2*b2) / (a2*a2);

  const p = Math.sqrt(x2*x2 + y2*y2);

  let φ2 = Math.atan2(z2, p * (1 - e2_2));
  for (let i = 0; i < 10; i++) {
    const sinφ2 = Math.sin(φ2);
    const ν2 = a2 / Math.sqrt(1 - e2_2 * sinφ2*sinφ2);
    φ2 = Math.atan2(z2 + e2_2 * ν2 * sinφ2, p);
  }
  const λ2 = Math.atan2(y2, x2);

  // Project OSGB36 lat/lon -> Easting/Northing (Transverse Mercator)
  return latLonToOSGBEN(radToDeg(φ2), radToDeg(λ2));
}

function latLonToOSGBEN(latDeg, lonDeg) {
  // Airy 1830 ellipsoid + OSGB projection
  const a = 6377563.396;
  const b = 6356256.909;
  const F0 = 0.9996012717;
  const lat0 = degToRad(49.0);
  const lon0 = degToRad(-2.0);
  const N0 = -100000.0;
  const E0 = 400000.0;
  const e2 = (a*a - b*b) / (a*a);
  const n = (a - b) / (a + b);

  const φ = degToRad(latDeg);
  const λ = degToRad(lonDeg);

  const sinφ = Math.sin(φ), cosφ = Math.cos(φ), tanφ = Math.tan(φ);

  const ν = a * F0 / Math.sqrt(1 - e2 * sinφ*sinφ);
  const ρ = a * F0 * (1 - e2) / Math.pow(1 - e2 * sinφ*sinφ, 1.5);
  const η2 = ν/ρ - 1;

  const M = meridionalArc(φ, lat0, n, b, F0);

  const I = M + N0;
  const II = (ν/2) * sinφ * cosφ;
  const III = (ν/24) * sinφ * Math.pow(cosφ,3) * (5 - tanφ*tanφ + 9*η2);
  const IIIA = (ν/720) * sinφ * Math.pow(cosφ,5) * (61 - 58*tanφ*tanφ + Math.pow(tanφ,4));
  const IV = ν * cosφ;
  const V = (ν/6) * Math.pow(cosφ,3) * (ν/ρ - tanφ*tanφ);
  const VI = (ν/120) * Math.pow(cosφ,5) * (5 - 18*tanφ*tanφ + Math.pow(tanφ,4) + 14*η2 - 58*tanφ*tanφ*η2);

  const dλ = λ - lon0;

  const N = I + II*dλ*dλ + III*Math.pow(dλ,4) + IIIA*Math.pow(dλ,6);
  const E = E0 + IV*dλ + V*Math.pow(dλ,3) + VI*Math.pow(dλ,5);

  return { E, N };
}

function meridionalArc(phi, phi0, n, b, F0) {
  const dPhi = phi - phi0;
  const sPhi = phi + phi0;

  const term1 = (1 + n + (5/4)*n*n + (5/4)*n*n*n) * dPhi;
  const term2 = (3*n + 3*n*n + (21/8)*n*n*n) * Math.sin(dPhi) * Math.cos(sPhi);
  const term3 = ((15/8)*n*n + (15/8)*n*n*n) * Math.sin(2*dPhi) * Math.cos(2*sPhi);
  const term4 = (35/24)*n*n*n * Math.sin(3*dPhi) * Math.cos(3*sPhi);

  return b * F0 * (term1 - term2 + term3 - term4);
}

function osGridRefFromEN(E, N, digits = 10) {
  // Valid OSGB grid is roughly E:0..700000, N:0..1300000
  if (!Number.isFinite(E) || !Number.isFinite(N)) return "";

  // 100km grid indices
  const e100k = Math.floor(E / 100000);
  const n100k = Math.floor(N / 100000);

  if (e100k < 0 || e100k > 6 || n100k < 0 || n100k > 12) return "";

  // Convert to grid letters
  // See OS lettering scheme (skips I)
  const l1 = (19 - n100k) - (19 - n100k) % 5 + Math.floor((e100k + 10) / 5);
  const l2 = (19 - n100k) * 5 % 25 + (e100k % 5);

  const letters = "ABCDEFGHJKLMNOPQRSTUVWXYZ";
  const first = letters.charAt(l1);
  const second = letters.charAt(l2);

  // Remainders within 100km square
  let e = Math.floor(E % 100000);
  let n = Math.floor(N % 100000);

  // digits must be even: 0,2,4,6,8,10
  digits = Math.max(0, Math.min(10, Math.floor(digits / 2) * 2));
  const d = digits / 2;

  if (digits === 0) return `${first}${second}`;

  const eStr = String(Math.floor(e / Math.pow(10, 5 - d))).padStart(d, "0");
  const nStr = String(Math.floor(n / Math.pow(10, 5 - d))).padStart(d, "0");

  return `${first}${second} ${eStr} ${nStr}`;
}

function degToRad(d) { return d * Math.PI / 180; }
function radToDeg(r) { return r * 180 / Math.PI; }

