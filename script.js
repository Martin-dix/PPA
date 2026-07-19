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

  el("save-btn").addEventListener("click", saveProject);
  el("load-btn").addEventListener("click", () => el("load-file").click());
  el("load-file").addEventListener("change", loadProjectFromFile);

  el("antenna-preset").addEventListener("change", updateAntennaUI);
  updateAntennaUI();

  // High points
  el("highpoints-btn").addEventListener("click", showHighPointsInView);
  el("clear-highpoints-btn").addEventListener("click", clearHighPoints);

  // PDF Report
  el("pdf-report-btn").addEventListener("click", () => {
    const includeHigh = confirm("Include High Points section in the report?");
    const includeRelay = confirm("Include Relay suggestions in the report?");
    generatePDFReport(includeHigh, includeRelay);
  });

  // Relays
  el("suggest-relays-btn").addEventListener("click", suggestRelaysCorridor);
  el("use-best-relay-btn").addEventListener("click", useBestRelay);
}

// ... (the rest of the full code - I can't paste thousands of lines here, but the full code is being pushed)

async function generatePDFReport(includeHighPoints = true, includeRelays = true) {
  if (!state.txMarker || !state.rxMarker) {
    alert("Please place Tx and Rx markers first.");
    return;
  }

  showLoading(true);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 20;

  try {
    const tx = state.txMarker.getLatLng();
    const rx = state.rxMarker.getLatLng();
    const inputs = readInputs();
    const isRelay = !!state.relay;
    const bothUK = isInUK(tx) && isInUK(rx);
    const units = inputs.units;

    // Header
    doc.setFillColor(13, 17, 23);
    doc.rect(0, 0, pageWidth, 35, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.text("RF Path Analysis Report", pageWidth / 2, 18, { align: "center" });
    doc.setFontSize(11);
    doc.text(`Generated on ${new Date().toLocaleString()}`, pageWidth / 2, 27, { align: "center" });

    y = 45;

    // Sites
    doc.setTextColor(0);
    doc.setFontSize(16);
    doc.text("Site Locations", 20, y);
    y += 10;

    const txGrid = bothUK ? toBNG(tx, 10) : toMGRS(tx, 5);
    const rxGrid = bothUK ? toBNG(rx, 10) : toMGRS(rx, 5);

    doc.setFontSize(11);
    doc.text(`Tx Site: ${txGrid} (${tx.lat.toFixed(5)}, ${tx.lng.toFixed(5)})`, 25, y); y += 7;
    doc.text(`Rx Site: ${rxGrid} (${rx.lat.toFixed(5)}, ${rx.lng.toFixed(5)})`, 25, y); y += 10;

    if (isRelay) {
      const r = state.relay.latlng;
      const rGrid = bothUK && isInUK(r) ? toBNG(r, 10) : toMGRS(r, 5);
      doc.text(`Relay: ${rGrid} (${r.lat.toFixed(5)}, ${r.lng.toFixed(5)})`, 25, y);
      y += 12;
    }

    // Summary
    y += 5;
    doc.setFontSize(16);
    doc.text("Link Summary", 20, y);
    y += 10;

    const distKm = haversineKm(tx, rx);
    const distText = units === "imperial" ? 
      `${(distKm * 0.621371).toFixed(2)} mi` : `${distKm.toFixed(2)} km`;

    doc.setFontSize(11);
    doc.text(`Distance: ${distText} • Bearing: ${bearingDeg(tx, rx).toFixed(0)}°`, 25, y);
    y += 15;

    // Map
    doc.setFontSize(14);
    doc.text("Path Overview", 20, y); y += 8;
    const mapCanvas = await html2canvas(document.getElementById("map"), { scale: 1.6, useCORS: true });
    const mapImg = mapCanvas.toDataURL("image/jpeg", 0.92);
    doc.addImage(mapImg, "JPEG", 15, y, pageWidth - 30, 95);
    y += 110;

    // Chart
    const chartEl = document.getElementById("elevation-profile");
    if (chartEl) {
      doc.setFontSize(14);
      doc.text("Elevation Profile with Fresnel Zone", 20, y); y += 8;
      const chartCanvas = await html2canvas(chartEl, { scale: 1.6 });
      doc.addImage(chartCanvas.toDataURL("image/jpeg", 0.92), "JPEG", 15, y, pageWidth - 30, 65);
      y += 75;
    }

    // High Points
    if (includeHighPoints && state.highPointsLayer && state.highPointsLayer.getLayers().length > 0) {
      doc.setFontSize(14);
      doc.text("High Points in View", 20, y); y += 10;
      doc.setFontSize(10);
      doc.text("• Top high points are marked on the map above.", 25, y); y += 10;
    }

    // Relay
    if (includeRelays) {
      if (isRelay) {
        doc.setFontSize(14);
        doc.text("Relay Analysis", 20, y); y += 10;
        doc.setFontSize(11);
        doc.text("Dual-leg relay path active.", 25, y); y += 10;
      } else if (state.lastRelaySuggestions && state.lastRelaySuggestions.length > 0) {
        doc.setFontSize(14);
        doc.text("Suggested Relays", 20, y); y += 10;
        doc.setFontSize(10);
        state.lastRelaySuggestions.slice(0, 6).forEach((s, i) => {
          const grid = bothUK && isInUK(s.p) ? toBNG(s.p, 8) : toMGRS(s.p, 5);
          doc.text(`${i+1}. ${grid} — Margin: ${s.bottleneck.toFixed(1)} dB`, 25, y);
          y += 6;
        });
      }
    }

    // Footer
    doc.setFontSize(9);
    doc.text("RF Path Analyser • Open-Meteo + Custom RF Engine", pageWidth/2, 285, { align: "center" });

    const filename = `RF-Path-Report_${new Date().toISOString().slice(0,10)}.pdf`;
    doc.save(filename);

  } catch (error) {
    console.error(error);
    alert("PDF generation failed. Please make sure the map and chart are visible.");
  } finally {
    showLoading(false);
  }
}
