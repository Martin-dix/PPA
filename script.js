/* =========================================================
   RF Path Analyser – FULL VERSION WITH PDF REPORT
   ========================================================= */

const state = {
  map: null,
  txMarker: null,
  rxMarker: null,

  directLine: null,
  fresnelMarker: null,
  diffMarker: null,

  relay: null,
  relayPathLines: [],
  relaySuggestLayer: null,
  lastRelaySuggestions: [],

  highPointsLayer: L.layerGroup(),

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

/* ===================== UI wiring ===================== */

function wireUI() {
  el("analyze").addEventListener("click", analyzePath);
  el("reverse").addEventListener("click", reversePath);
  el("clear-btn").addEventListener("click", clearTxRx);
  el("clear-relay-btn").addEventListener("click", () => { clearRelay(); analyzePath(); });

  el("units").addEventListener("change", updateSummary);

  el("copy-btn").addEventListener("click", copySummary);
  el("pdf-btn").addEventListener("click", generatePdfReport);

  el("save-btn").addEventListener("click", saveProject);
  el("load-btn").addEventListener("click", () => el("load-file").click());
  el("load-file").addEventListener("change", loadProjectFromFile);

  el("antenna-preset").addEventListener("change", updateAntennaUI);
  updateAntennaUI();
}

/* ===================== Map ===================== */

function initMap() {
  state.map = L.map("map", { zoomControl: true }).setView([51.5, -2], 7);

  const tileOpts = { maxZoom: 19, crossOrigin: true };

  const street = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    ...tileOpts, attribution: "© OpenStreetMap"
  });

  const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    ...tileOpts, maxZoom: 17, attribution: "© OpenTopoMap"
  });

  const satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { ...tileOpts, attribution: "© Esri" }
  );

  street.addTo(state.map);

  L.control.layers(
    { Street: street, Topographic: topo, Satellite: satellite },
    null,
    { position: "topleft" }
  ).addTo(state.map);

  state.map.on("click", (e) => {
    if (!state.txMarker) setMarker("tx", e.latlng);
    else if (!state.rxMarker) setMarker("rx", e.latlng);
    updateSummary();
  });

  setTimeout(() => state.map.invalidateSize(), 150);
  window.addEventListener("resize", () => state.map.invalidateSize());
}

/* ===================== Marker handling ===================== */

function setMarker(which, latlng) {
  const isTx = which === "tx";
  const existing = isTx ? state.txMarker : state.rxMarker;
  if (existing) state.map.removeLayer(existing);

  const marker = L.marker(latlng, { draggable: true })
    .addTo(state.map)
    .bindPopup(isTx ? "Tx" : "Rx");

  marker.on("dragend", updateSummary);

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
  hideCritical();
  updateSummary();
}

function reversePath() {
  if (!state.txMarker || !state.rxMarker) return;
  const tx = state.txMarker.getLatLng();
  const rx = state.rxMarker.getLatLng();
  setMarker("tx", rx);
  setMarker("rx", tx);
  updateSummary();
}

/* ===================== Summary bar ===================== */

function updateSummary() {
  const tx = state.txMarker?.getLatLng() || null;
  const rx = state.rxMarker?.getLatLng() || null;

  el("tx-label").textContent = tx ? toBNG(tx, 10) : "Click map";
  el("rx-label").textContent = rx ? toBNG(rx, 10) : "Click map";

  if (tx && rx) {
    const d = haversineKm(tx, rx).toFixed(2);
    const b = bearingDeg(tx, rx).toFixed(0);
    el("bearing-distance").textContent = `${d} km • ${b}°`;
    drawDirectLine(tx, rx, "#00c8ff");
  } else {
    el("bearing-distance").textContent = "";
    clearDirectDrawing();
  }
}

/* ===================== Drawing ===================== */

function drawDirectLine(a, b, color) {
  clearDirectDrawing();
  state.directLine = L.polyline([a, b], { color, weight: 5 }).addTo(state.map);
}

function clearDirectDrawing() {
  if (state.directLine) state.map.removeLayer(state.directLine);
  state.directLine = null;
}

function clearAnalysisMarkers() {
  if (state.fresnelMarker) state.map.removeLayer(state.fresnelMarker);
  if (state.diffMarker) state.map.removeLayer(state.diffMarker);
  state.fresnelMarker = null;
  state.diffMarker = null;
}

/* ===================== Inputs ===================== */

function readInputs() {
  return {
    freqMHz: +el("frequency").value,
    txHeight_m: +el("txHeight").value,
    rxHeight_m: +el("rxHeight").value,
    txPowerW: +el("txPowerW").value,
    sysLossDb: +el("sysLossDb").value,
    rxSensDbm: +el("rxSensDbm").value,
    fadeMarginDb: +el("fadeMarginDb").value,
    terrain: el("terrain-type").value,
    fresnelFactor: +el("fresnel-req").value,
    kFactor: +el("kfactor").value,
    successRule: el("success-rule").value,
    heightSolve: el("height-solve").value,
    antGainDb: getAntennaGainDb(),
  };
}

function getAntennaGainDb() {
  const v = el("antenna-preset").value;
  if (v === "custom") return +el("customGainDb").value;
  return { hcdr_elev_3_5: 3.5, vhf_mono_2_5: 2.5, vhf_dipole_3_0: 3.0 }[v] ?? 3.0;
}

function updateAntennaUI() {
  el("custom-gain-wrap").classList.toggle(
    "hidden",
    el("antenna-preset").value !== "custom"
  );
}

/* ===================== Analysis (simplified direct) ===================== */

async function analyzePath() {
  if (!state.txMarker || !state.rxMarker) return;
  renderCriticalBasic();
}

function renderCriticalBasic() {
  const tx = state.txMarker.getLatLng();
  const rx = state.rxMarker.getLatLng();
  const d = haversineKm(tx, rx);
  const b = bearingDeg(tx, rx);

  const c = el("critical");
  c.classList.remove("hidden");
  c.innerHTML = `
    <b>Link Summary</b><br>
    Distance: ${d.toFixed(2)} km<br>
    Bearing: ${b.toFixed(0)}°<br>
    Tx: ${toBNG(tx,10)}<br>
    Rx: ${toBNG(rx,10)}
  `;
}

/* ===================== PDF REPORT ===================== */

async function generatePdfReport() {
  if (!state.txMarker || !state.rxMarker) {
    alert("Place Tx and Rx first.");
    return;
  }

  showLoading(true);

  try {
    await new Promise(r => setTimeout(r, 300));
    state.map.invalidateSize(true);

    const tx = state.txMarker.getLatLng();
    const rx = state.rxMarker.getLatLng();
    const relay = state.relay?.latlng || null;
    const inputs = readInputs();

    const mapCanvas = await html2canvas(el("map"), { useCORS: true, scale: 2 });
    const critCanvas = await html2canvas(el("critical"), { scale: 2 });

    const chartCanvas = el("elevation-profile");
    const chartImg = chartCanvas?.toDataURL("image/png") || null;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });

    const m = 12;
    let y = 18;

    doc.setFontSize(16);
    doc.text("RF Path Analyser Report", m, y);
    y += 8;

    doc.setFontSize(10);
    doc.text(`Tx: ${toBNG(tx,10)} (${tx.lat.toFixed(5)}, ${tx.lng.toFixed(5)})`, m, y); y+=5;
    doc.text(`Rx: ${toBNG(rx,10)} (${rx.lat.toFixed(5)}, ${rx.lng.toFixed(5)})`, m, y); y+=5;
    doc.text(`Relay: ${relay ? toBNG(relay,10) : "None"}`, m, y); y+=8;

    doc.text(`Frequency: ${inputs.freqMHz} MHz`, m, y); y+=5;
    doc.text(`Tx Height: ${inputs.txHeight_m} m   Rx Height: ${inputs.rxHeight_m} m`, m, y); y+=5;
    doc.text(`Tx Power: ${inputs.txPowerW} W   Ant Gain: ${inputs.antGainDb} dBi`, m, y); y+=8;

    doc.addImage(critCanvas.toDataURL("image/png"), "PNG", m, y, 180, 40);
    y += 48;

    doc.addImage(mapCanvas.toDataURL("image/png"), "PNG", m, y, 180, 100);
    y += 108;

    if (chartImg) {
      doc.addPage();
      doc.text("Elevation Profile", m, 18);
      doc.addImage(chartImg, "PNG", m, 24, 180, 100);
    }

    doc.save(`rf-path-report-${Date.now()}.pdf`);
  } catch (e) {
    console.error(e);
    alert("PDF generation failed.");
  } finally {
    showLoading(false);
  }
}

/* ===================== Save / Load ===================== */

function copySummary() {
  if (!state.txMarker || !state.rxMarker) return;
  const tx = state.txMarker.getLatLng();
  const rx = state.rxMarker.getLatLng();
  navigator.clipboard.writeText(
    `Tx ${toBNG(tx,10)}\nRx ${toBNG(rx,10)}`
  );
}

function saveProject() {
  const data = {
    tx: state.txMarker?.getLatLng() || null,
    rx: state.rxMarker?.getLatLng() || null,
    inputs: readInputs()
  };
  const blob = new Blob([JSON.stringify(data,null,2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "rf-path-project.json";
  a.click();
}

function loadProjectFromFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    const obj = JSON.parse(r.result);
    clearTxRx();
    if (obj.tx) setMarker("tx", obj.tx);
    if (obj.rx) setMarker("rx", obj.rx);
    updateSummary();
    analyzePath();
  };
  r.readAsText(file);
}

/* ===================== Helpers ===================== */

function showLoading(on) {
  el("loading").classList.toggle("hidden", !on);
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI/180;
  const dLon = (b.lng - a.lng) * Math.PI/180;
  const s = Math.sin(dLat/2)**2 +
            Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*
            Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function bearingDeg(a, b) {
  const y = Math.sin((b.lng-a.lng)*Math.PI/180)*Math.cos(b.lat*Math.PI/180);
  const x = Math.cos(a.lat*Math.PI/180)*Math.sin(b.lat*Math.PI/180) -
            Math.sin(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*
            Math.cos((b.lng-a.lng)*Math.PI/180);
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
}

/* ===================== BNG (simplified) ===================== */

function toBNG(latlng) {
  return `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
}
