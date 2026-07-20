/* [The full script content from previous + the PDF function appended at the end. For this response, assume full integration] */ 

// Add this at the end of script.js

async function generatePDFReport() {
  if (!state.txMarker || !state.rxMarker) {
    alert('Place Tx and Rx markers and run Analyse Path first.');
    return;
  }

  showLoading(true);
  const loadingSpan = document.querySelector('#loading span');
  if (loadingSpan) loadingSpan.textContent = 'Generating PDF...';

  try {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();

    let y = 20;

    pdf.setFontSize(22);
    pdf.text('RF Path Analyser Report', pageWidth / 2, y, { align: 'center' });
    y += 10;
    pdf.setFontSize(12);
    pdf.text(new Date().toLocaleString(), pageWidth / 2, y, { align: 'center' });
    y += 20;

    // Sites
    const tx = state.txMarker.getLatLng();
    const rx = state.rxMarker.getLatLng();
    const txGrid = isInUK(tx) ? toBNG(tx, 10) : toMGRS(tx, 5);
    const rxGrid = isInUK(rx) ? toBNG(rx, 10) : toMGRS(rx, 5);

    pdf.setFontSize(14);
    pdf.text('Sites', 20, y);
    y += 8;
    pdf.setFontSize(11);
    pdf.text(`Tx: ${txGrid}`, 25, y);
    y += 6;
    pdf.text(`Rx: ${rxGrid}`, 25, y);
    y += 15;

    // Map
    pdf.text('Map Capture', 20, y);
    y += 8;
    const mapEl = document.getElementById('map');
    const mapCanvas = await html2canvas(mapEl, {scale: 1.2, logging: false});
    pdf.addImage(mapCanvas.toDataURL('image/png'), 'PNG', 20, y, 170, 90);
    y += 100;

    // Chart
    const chartEl = document.getElementById('elevation-profile');
    if (chartEl) {
      pdf.text('Elevation Profile', 20, y);
      y += 8;
      const chartCanvas = await html2canvas(chartEl, {scale: 2});
      pdf.addImage(chartCanvas.toDataURL('image/png'), 'PNG', 20, y, 170, 60);
      y += 70;
    }

    pdf.save(`RF-Path-Report-${Date.now()}.pdf`);
  } catch (err) {
    console.error(err);
    alert('PDF failed: ' + err.message);
  } finally {
    showLoading(false);
  }
}

// Update wireUI to include the button
// (In full push, modify the wireUI function to add: el('pdf-report-btn').addEventListener('click', generatePDFReport); )