// Global variables for map, markers, layers, and state
let map, transmitter, receiver, polylineLayer = null, txMarker = null, rxMarker = null, elevationChart = null, streetLayer, satelliteLayer, placementMode = 'click';
let atmosphericData = { humidity: 50, temperature: 15, pressure: 1013 }; // Default atmospheric values
let lastAtmosphericUpdate = 0;

// Initialize the map with Leaflet
function initMap() {
    map = L.map('map').setView([51.505, -0.09], 13); // Default to London

    // Define base layers
    streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });

    satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
    });

    // Add street layer as default
    streetLayer.addTo(map);

    // Add click handler for placing markers
    map.on('click', (e) => {
        if (placementMode === 'click') {
            if (!transmitter) {
                transmitter = e.latlng;
                txMarker = L.marker(transmitter, { 
                    icon: L.icon({
                        iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PGNpcmNsZSBjeD0iNSIgY3k9IjUiIHI9IjUiIGZpbGw9ImJsdWUiLz48L3N2Zz4=',
                        iconSize: [10, 10],
                        iconAnchor: [5, 5],
                        popupAnchor: [0, -5]
                    }),
                    draggable: true 
                }).addTo(map).bindPopup('Transmitter').openPopup();
                txMarker.on('dragend', onMarkerDrag);
                snapToRoad(txMarker);
                updateAtmosphericConditions(); // Update conditions when placing transmitter
            } else if (!receiver) {
                receiver = e.latlng;
                rxMarker = L.marker(receiver, { 
                    icon: L.icon({
                        iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PGNpcmNsZSBjeD0iNSIgY3k9IjUiIHI9IjUiIGZpbGw9InJlZCIvPjwvc3ZnPg==',
                        iconSize: [10, 10],
                        iconAnchor: [5, 5],
                        popupAnchor: [0, -5]
                    }),
                    draggable: true 
                }).addTo(map).bindPopup('Receiver').openPopup();
                rxMarker.on('dragend', onMarkerDrag);
                snapToRoad(rxMarker);
                if (polylineLayer) map.removeLayer(polylineLayer);
                updatePolyline(); // Update or create polyline with initial color
                analyzePath(); // Auto-analyze when receiver is set
            } else {
                map.removeLayer(txMarker);
                map.removeLayer(rxMarker);
                if (polylineLayer) map.removeLayer(polylineLayer);
                transmitter = e.latlng;
                receiver = null;
                txMarker = L.marker(transmitter, { 
                    icon: L.icon({
                        iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PGNpcmNsZSBjeD0iNSIgY3k9IjUiIHI9IjUiIGZpbGw9ImJsdWUiLz48L3N2Zz4=',
                        iconSize: [10, 10],
                        iconAnchor: [5, 5],
                        popupAnchor: [0, -5]
                    }),
                    draggable: true 
                }).addTo(map).bindPopup('Transmitter').openPopup();
                txMarker.on('dragend', onMarkerDrag);
                snapToRoad(txMarker);
                rxMarker = null;
                updatePolyline(); // Reset polyline if needed
                updateAtmosphericConditions(); // Update conditions when moving transmitter
            }
        }
    });

    // Add zoom control and scale bar
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.control.scale().addTo(map);
}

// Switch between map layers
function changeMapLayer(layer) {
    if (!map) {
        console.error('Map not initialized. Please check console for errors.');
        return;
    }

    // Remove all tile layers
    map.eachLayer((layerObj) => {
        if (layerObj instanceof L.TileLayer) {
            map.removeLayer(layerObj);
        }
    });

    // Add the selected layer
    if (layer === 'street') {
        streetLayer.addTo(map);
    } else if (layer === 'satellite') {
        satelliteLayer.addTo(map);
    } else {
        console.warn('Unknown layer type:', layer);
        streetLayer.addTo(map); // Default to street if invalid
    }
}

function updatePlacementMode(mode) {
    placementMode = mode;
    const bngGroup = document.getElementById('bng-group');
    if (mode === 'click') {
        bngGroup.style.display = 'none';
        map.off('click'); // Remove BNG click handler if any
        map.on('click', (e) => {
            if (!transmitter) {
                transmitter = e.latlng;
                txMarker = L.marker(transmitter, { 
                    icon: L.icon({
                        iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PGNpcmNsZSBjeD0iNSIgY3k9IjUiIHI9IjUiIGZpbGw9ImJsdWUiLz48L3N2Zz4=',
                        iconSize: [10, 10],
                        iconAnchor: [5, 5],
                        popupAnchor: [0, -5]
                    }),
                    draggable: true 
                }).addTo(map).bindPopup('Transmitter').openPopup();
                txMarker.on('dragend', onMarkerDrag);
                snapToRoad(txMarker);
                updateAtmosphericConditions(); // Update conditions when placing transmitter
            } else if (!receiver) {
                receiver = e.latlng;
                rxMarker = L.marker(receiver, { 
                    icon: L.icon({
                        iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PGNpcmNsZSBjeD0iNSIgY3y9IjUiIHI9IjUiIGZpbGw9InJlZCIvPjwvc3ZnPg==',
                        iconSize: [10, 10],
                        iconAnchor: [5, 5],
                        popupAnchor: [0, -5]
                    }),
                    draggable: true 
                }).addTo(map).bindPopup('Receiver').openPopup();
                rxMarker.on('dragend', onMarkerDrag);
                snapToRoad(rxMarker);
                if (polylineLayer) map.removeLayer(polylineLayer);
                updatePolyline(); // Update or create polyline with initial color
                analyzePath(); // Auto-analyze when receiver is set
            } else {
                map.removeLayer(txMarker);
                map.removeLayer(rxMarker);
                if (polylineLayer) map.removeLayer(polylineLayer);
                transmitter = e.latlng;
                receiver = null;
                txMarker = L.marker(transmitter, { 
                    icon: L.icon({
                        iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PGNpcmNsZSBjeD0iNSIgY3y9IjUiIHI9IjUiIGZpbGw9ImJsdWUiLz48L3N2Zz4=',
                        iconSize: [10, 10],
                        iconAnchor: [5, 5],
                        popupAnchor: [0, -5]
                    }),
                    draggable: true 
                }).addTo(map).bindPopup('Transmitter').openPopup();
                txMarker.on('dragend', onMarkerDrag);
                snapToRoad(txMarker);
                rxMarker = null;
                updatePolyline(); // Reset polyline if needed
                updateAtmosphericConditions(); // Update conditions when moving transmitter
            }
        });
    } else if (mode === 'bng') {
        bngGroup.style.display = 'block';
        map.off('click'); // Remove click handler for BNG mode
    }
}

// Convert British National Grid (BNG) reference to latitude/longitude (simplified approximation)
function bngToLatLon(bng) {
    bng = bng.toUpperCase().trim();
    if (!/^[A-Z]{2}\d{6,8}$/.test(bng)) {
        alert('Invalid BNG reference. Use format like TQ123456 (6 or 8 digits).');
        return null;
    }

    const square = bng.substring(0, 2); // e.g., TQ
    const digits = bng.substring(2); // e.g., 123456 or 12323456
    const easting = parseInt(digits.substring(0, digits.length / 2));
    const northing = parseInt(digits.substring(digits.length / 2));

    // Map square to base coordinates (simplified, approximate for TQ square)
    const squareCoords = {
        'TQ': { east: 500000, north: 100000 }, // TQ square base (approximate)
        // Add more squares as needed (e.g., SU, SP, etc.)
    };

    if (!squareCoords[square]) {
        alert('Unsupported BNG square. Use TQ for now (add more in code if needed).');
        return null;
    }

    // Adjust for 6 or 8 digits (6 digits = 100m precision, 8 digits = 10m precision)
    let precision = 100; // Default for 6 digits
    if (digits.length === 8) precision = 10;

    const fullEasting = squareCoords[square].east + easting * precision;
    const fullNorthing = squareCoords[square].north + northing * precision;

    // Simplified conversion from OSGB36 (BNG) to WGS84 (lat/lon)
    const lat = (fullNorthing / 100000) * 0.9 + 49.5; // Approximate for TQ (London area)
    const lon = (fullEasting / 100000) * 1.2 - 0.5;   // Approximate for TQ (London area)

    return L.latLng(lat, lon);
}

function placeFromBNG(type) {
    const bngInput = type === 'transmitter' ? document.getElementById('txBNG') : document.getElementById('rxBNG');
    const bng = bngInput.value;
    const latLon = bngToLatLon(bng);
    if (!latLon) return;

    if (type === 'transmitter') {
        if (txMarker) map.removeLayer(txMarker);
        transmitter = latLon;
        txMarker = L.marker(transmitter, { 
            icon: L.icon({
                iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PGNpcmNsZSBjeD0iNSIgY3y9IjUiIHI9IjUiIGZpbGw9ImJsdWUiLz48L3N2Zz4=',
                iconSize: [10, 10],
                iconAnchor: [5, 5],
                popupAnchor: [0, -5]
            }),
            draggable: true 
        }).addTo(map).bindPopup('Transmitter').openPopup();
        txMarker.on('dragend', onMarkerDrag);
        snapToRoad(txMarker);
        updateAtmosphericConditions(); // Update conditions when placing transmitter
    } else if (type === 'receiver') {
        if (rxMarker) map.removeLayer(rxMarker);
        receiver = latLon;
        rxMarker = L.marker(receiver, { 
            icon: L.icon({
                iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PGNpcmNsZSBjeD0iNSIgY3y9IjUiIHI9IjUiIGZpbGw9InJlZCIvPjwvc3ZnPg==',
                iconSize: [10, 10],
                iconAnchor: [5, 5],
                popupAnchor: [0, -5]
            }),
            draggable: true 
        }).addTo(map).bindPopup('Receiver').openPopup();
        rxMarker.on('dragend', onMarkerDrag);
        snapToRoad(rxMarker);
        if (polylineLayer) map.removeLayer(polylineLayer);
        updatePolyline(); // Update or create polyline with initial color
        analyzePath(); // Auto-analyze when receiver is set
    }
}

function onMarkerDrag(e) {
    const marker = e.target;
    const latLng = marker.getLatLng();
    if (marker === txMarker) {
        transmitter = latLng;
    } else if (marker === rxMarker) {
        receiver = latLng;
    }
    if (transmitter && receiver) {
        if (polylineLayer) map.removeLayer(polylineLayer);
        updatePolyline(); // Update polyline after drag
        snapToRoad(marker); // Snap to road after drag
        analyzePath(); // Re-analyze after dragging
        updateAtmosphericConditions(); // Update conditions when dragging markers
    }
}

function snapToRoad(marker) {
    const latLng = marker.getLatLng();
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latLng.lat}&lon=${latLng.lng}&addressdetails=1`)
        .then(response => response.json())
        .then(data => {
            if (data && data.address && data.address.road) {
                fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(data.address.road)}&format=json&limit=1`)
                    .then(response => response.json())
                    .then(roadData => {
                        if (roadData && roadData.length > 0) {
                            const roadLatLng = L.latLng(roadData[0].lat, roadData[0].lon);
                            marker.setLatLng(roadLatLng);
                            if (marker === txMarker) transmitter = roadLatLng;
                            else if (marker === rxMarker) receiver = roadLatLng;
                            if (transmitter && receiver) {
                                if (polylineLayer) map.removeLayer(polylineLayer);
                                updatePolyline();
                                analyzePath();
                            }
                        }
                    })
                    .catch(error => console.error('Error snapping to road:', error));
            }
        })
        .catch(error => console.error('Error getting road data:', error));
}

async function fetchElevationData(tx, rx, numPoints, retries = 3) {
    showLoading(true);
    console.log('Attempting to fetch elevation data for:', tx, rx, numPoints, 'Retries left:', retries);
    if (!tx || !rx || isNaN(numPoints) || numPoints <= 0) {
        showLoading(false);
        throw new Error('Invalid coordinates or number of points');
    }

    const coords = [];
    for (let i = 0; i <= numPoints; i++) {
        const fraction = i / numPoints;
        const lat = tx.lat + fraction * (rx.lat - tx.lat);
        const lon = tx.lng + fraction * (rx.lng - tx.lng);
        coords.push(`${lat},${lon}`);
    }

    const locations = coords.join('|');
    const url = `https://api.open-elevation.com/api/v1/lookup?locations=${locations}`;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10-second timeout

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) {
            if (response.status === 429 && retries > 0) { // Rate limit exceeded
                console.warn('Rate limit hit, retrying in 2 seconds...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                return await fetchElevationData(tx, rx, numPoints, retries - 1);
            }
            throw new Error(`Elevation API failed with status ${response.status}`);
        }
        const data = await response.json();
        if (!data.results || !Array.isArray(data.results)) {
            throw new Error('Invalid elevation data format');
        }
        const elevations = [];
        const stepDistance = tx.distanceTo(rx) / numPoints;
        data.results.forEach((result, i) => {
            if (result.elevation !== undefined) {
                elevations.push({ distance: i * stepDistance, height: result.elevation });
            }
        });
        if (elevations.length === 0) {
            throw new Error('No valid elevation data received');
        }
        showLoading(false);
        return elevations;
    } catch (error) {
        showLoading(false);
        if (error.name === 'AbortError') {
            console.error('Request timed out:', error);
            alert('Elevation data request timed out. Check your internet connection or try again later.');
        } else if (retries > 0 && error.message.includes('429')) {
            console.warn('Retrying due to rate limit...');
            return await fetchElevationData(tx, rx, numPoints, retries - 1);
        } else {
            console.error('Error fetching elevation:', error);
            alert(`Error fetching elevation data: ${error.message}. Check console for details.`);
        }
        return [];
    }
}

function getFrequency() {
    const freqInput = document.getElementById('frequency').value;
    const freqMHz = parseFloat(freqInput) || 30;
    if (isNaN(freqMHz)) {
        alert('Invalid frequency value. Defaulting to 30 MHz.');
        document.getElementById('frequency').value = '30';
        document.getElementById('frequency').classList.remove('invalid');
        return 30 * 1e6; // Default to 30 MHz in Hz
    }
    if ((freqMHz >= 30 && freqMHz <= 87.975) || (freqMHz >= 225 && freqMHz <= 450)) {
        document.getElementById('frequency').classList.remove('invalid');
        return freqMHz * 1e6; // Convert to Hz
    }
    alert('Frequency must be between 30-87.975 MHz or 225-450 MHz. Defaulting to 30 MHz.');
    document.getElementById('frequency').classList.remove('invalid');
    document.getElementById('frequency').value = '30';
    return 30 * 1e6; // Default to 30 MHz in Hz
}

function getAntennaHeights() {
    const txHeightInput = document.getElementById('txHeight').value;
    const rxHeightInput = document.getElementById('rxHeight').value;
    const txHeight = parseFloat(txHeightInput) || 5;
    const rxHeight = parseFloat(rxHeightInput) || 5;
    if (isNaN(txHeight) || txHeight < 0) {
        alert('Invalid transmitter height. Defaulting to 5 meters.');
        document.getElementById('txHeight').value = '5';
        document.getElementById('txHeight').classList.remove('invalid');
        return { txHeight: 5, rxHeight };
    }
    if (isNaN(rxHeight) || rxHeight < 0) {
        alert('Invalid receiver height. Defaulting to 5 meters.');
        document.getElementById('rxHeight').value = '5';
        document.getElementById('rxHeight').classList.remove('invalid');
        return { txHeight, rxHeight: 5 };
    }
    document.getElementById('txHeight').classList.remove('invalid');
    document.getElementById('rxHeight').classList.remove('invalid');
    return { txHeight, rxHeight };
}

function getLinkParameters() {
    const txPowerInput = document.getElementById('txPower').value;
    const rxSensitivityInput = document.getElementById('rxSensitivity').value;
    const txAntennaGain = parseFloat(document.getElementById('txAntennaGain').value) || 0;
    const rxAntennaGain = parseFloat(document.getElementById('rxAntennaGain').value) || 0;
    const txPowerWatts = parseFloat(txPowerInput) || 1; // Default to 1 W (30 dBm)
    const rxSensitivity = parseFloat(rxSensitivityInput) || -90; // Default to -90 dBm

    if (isNaN(txPowerWatts) || txPowerWatts <= 0) {
        alert('Invalid transmitter power. Power must be a positive value in watts. Defaulting to 1 W (30 dBm).');
        document.getElementById('txPower').value = '1';
        document.getElementById('txPower').classList.remove('invalid');
        return { txPower: 30, rxSensitivity: -90, txAntennaGain: 0, rxAntennaGain: 0 }; // 1 W = 30 dBm
    }
    if (isNaN(rxSensitivity)) {
        alert('Invalid receiver sensitivity. Defaulting to -90 dBm.');
        document.getElementById('rxSensitivity').value = '-90';
        document.getElementById('rxSensitivity').classList.remove('invalid');
        return { txPower: wattsToDbm(txPowerWatts), rxSensitivity: -90, txAntennaGain, rxAntennaGain };
    }
    if (isNaN(txAntennaGain) || txAntennaGain < -10 || txAntennaGain > 30) {
        alert('Invalid transmitter antenna gain. Must be between -10 and 30 dBi. Defaulting to 0 dBi.');
        document.getElementById('txAntennaGain').value = '0';
        document.getElementById('txAntennaGain').classList.remove('invalid');
        txAntennaGain = 0;
    }
    if (isNaN(rxAntennaGain) || rxAntennaGain < -10 || rxAntennaGain > 30) {
        alert('Invalid receiver antenna gain. Must be between -10 and 30 dBi. Defaulting to 0 dBi.');
        document.getElementById('rxAntennaGain').value = '0';
        document.getElementById('rxAntennaGain').classList.remove('invalid');
        rxAntennaGain = 0;
    }

    document.getElementById('txPower').classList.remove('invalid');
    document.getElementById('rxSensitivity').classList.remove('invalid');
    document.getElementById('txAntennaGain').classList.remove('invalid');
    document.getElementById('rxAntennaGain').classList.remove('invalid');
    return { txPower: wattsToDbm(txPowerWatts), rxSensitivity, txAntennaGain, rxAntennaGain };
}

// Convert watts to dBm
function wattsToDbm(watts) {
    return 10 * Math.log10(watts * 1000); // 1 W = 1000 mW, dBm = 10 * log10(mW)
}

// Convert dBm to watts (for display if needed)
function dbmToWatts(dbm) {
    return Math.pow(10, (dbm - 30) / 10); // 30 dBm = 1 W
}

async function analyzePath() {
    if (!map || !transmitter || !receiver) {
        document.getElementById('result').innerText = 'Map or points not initialized. Select both points first.';
        updatePolyline('gray'); // Gray if no analysis
        document.getElementById('fresnel-zone').style.display = 'none';
        document.getElementById('elevation-text').style.display = 'none';
        if (elevationChart) elevationChart.destroy();
        return;
    }

    const totalDistance = transmitter.distanceTo(receiver);
    if (isNaN(totalDistance) || totalDistance <= 0) {
        document.getElementById('result').innerText = 'Invalid path distance';
        updatePolyline('gray');
        document.getElementById('fresnel-zone').style.display = 'none';
        document.getElementById('elevation-text').style.display = 'none';
        if (elevationChart) elevationChart.destroy();
        return;
    }

    const granularity = document.getElementById('pathGranularity').value;
    let numPoints;
    switch (granularity) {
        case 'low': numPoints = 10; break;
        case 'medium': numPoints = 50; break;
        case 'high': numPoints = 100; break;
        default: numPoints = 50;
    }

    document.getElementById('result').innerText = 'Loading...';
    document.getElementById('elevation-container').style.display = 'block';
    document.getElementById('elevation-profile').style.display = 'block';
    document.getElementById('elevation-text').style.display = 'none';
    document.getElementById('fresnel-zone').innerHTML = '';
    document.getElementById('fresnel-zone').className = 'fresnel-zone';

    try {
        const elevations = await fetchElevationData(transmitter, receiver, numPoints);
        if (elevations.length === 0) {
            document.getElementById('result').innerText = 'Failed to fetch elevation data';
            updatePolyline('gray');
            document.getElementById('fresnel-zone').style.display = 'none';
            document.getElementById('elevation-text').style.display = 'none';
            if (elevationChart) elevationChart.destroy();
            return;
        }

        // Display elevation profile (prefer chart, fall back to text)
        const canvas = document.getElementById('elevation-profile');
        if (elevationChart) elevationChart.destroy();
        if (typeof Chart === 'undefined') {
            console.error('Chart.js not loaded. Falling back to text display.');
            let profileText = '<h3>Elevation Profile (meters):</h3><ul>';
            elevations.forEach(elevation => {
                profileText += `<li>Distance ${Math.round(elevation.distance)}m: ${elevation.height.toFixed(1)}m</li>`;
            });
            profileText += '</ul>';
            document.getElementById('elevation-text').innerHTML = profileText;
            document.getElementById('elevation-profile').style.display = 'none';
            document.getElementById('elevation-text').style.display = 'block';
        } else {
            elevationChart = new Chart(canvas, {
                type: 'line',
                data: {
                    labels: elevations.map(e => `${Math.round(e.distance)}m`),
                    datasets: [{
                        label: 'Elevation (m)',
                        data: elevations.map(e => e.height),
                        borderColor: 'blue',
                        fill: false,
                        tension: 0.1
                    }, {
                        label: 'Fresnel Clearance (m)',
                        data: elevations.map(e => {
                            const d1 = e.distance;
                            const d2 = totalDistance - d1;
                            const frequency = getFrequency();
                            const wavelength = 3e8 / frequency;
                            const { txHeight, rxHeight } = getAntennaHeights();
                            const fresnelRadius = Math.sqrt((wavelength * d1 * d2) / totalDistance);
                            return Math.min(txHeight, rxHeight) + fresnelRadius;
                        }),
                        borderColor: 'purple',
                        fill: false,
                        tension: 0.1
                    }, {
                        label: 'Min Effective Height (HF Skywave, m)',
                        data: elevations.map(() => {
                            const { txHeight } = getAntennaHeights();
                            return calculateMinEffectiveHeight(txHeight, getFrequency() / 1e6); // Convert Hz to MHz
                        }),
                        borderColor: 'orange',
                        fill: false,
                        tension: 0.1,
                        borderDash: [5, 5] // Dashed line for visibility
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { beginAtZero: true, title: { display: true, text: 'Height (m)' }, min: 0, max: 100 },
                        x: { title: { display: true, text: 'Distance (m)' } }
                    },
                    plugins: {
                        legend: {
                            position: 'top'
                        }
                    }
                }
            });
            document.getElementById('elevation-text').style.display = 'none';
            document.getElementById('elevation-profile').style.display = 'block';
        }

        calculateRF(totalDistance, elevations);
        visualizeFresnelZone(totalDistance, elevations);
    } catch (fetchError) {
        console.error('Error in fetch process:', fetchError);
        document.getElementById('result').innerText = `Error fetching or processing data: ${fetchError.message}`;
        updatePolyline('gray');
        document.getElementById('fresnel-zone').style.display = 'none';
        document.getElementById('elevation-text').style.display = 'none';
        if (elevationChart) elevationChart.destroy();
    }
}

function calculateRF(totalDistance, elevations) {
    const frequency = getFrequency();
    const { txHeight, rxHeight } = getAntennaHeights();
    const { txPower, rxSensitivity, txAntennaGain, rxAntennaGain } = getLinkParameters();
    const terrainType = document.getElementById('terrainType').value;
    const { humidity, temperature, pressure } = atmosphericData;

    if (isNaN(frequency) || isNaN(totalDistance) || isNaN(txHeight) || isNaN(rxHeight) || 
        isNaN(txPower) || isNaN(rxSensitivity) || isNaN(txAntennaGain) || isNaN(rxAntennaGain) || 
        isNaN(humidity) || isNaN(temperature) || isNaN(pressure) || elevations.length === 0) {
        throw new Error('Invalid input values or elevation data');
    }

    const fspl = 20 * Math.log10(totalDistance) + 20 * Math.log10(frequency) + 20 * Math.log10(4 * Math.PI / 3e8);

    // Terrain diffraction and clutter loss
    let terrainLoss = 0;
    switch (terrainType) {
        case 'open': terrainLoss = 0; break;
        case 'hilly': terrainLoss = 2; break;
        case 'urban': terrainLoss = 6; break;
        case 'forest': terrainLoss = 8; break;
        default: terrainLoss = 0;
    }
    terrainLoss *= (totalDistance / 1000); // Scale loss per km

    // Atmospheric attenuation (simplified ITU-R P.453 model for VHF/UHF, approximate for HF)
    let atmosphericLoss = 0;
    if (frequency / 1e6 <= 30) { // HF
        atmosphericLoss = Math.min(0.1 * (totalDistance / 1000), 5); // Max 5 dB for long paths
    } else { // VHF/UHF
        const humidityFactor = Math.max(0, humidity - 50) * 0.01 * (totalDistance / 1000);
        const tempFactor = (temperature - 15) * 0.02 * (totalDistance / 1000);
        const pressureFactor = (pressure - 1013) * 0.001 * (totalDistance / 1000);
        atmosphericLoss = humidityFactor + tempFactor + pressureFactor;
    }

    // Knife-edge diffraction (refined)
    const maxElevation = Math.max(...elevations.map(e => e.height || 0));
    const heightDiff = maxElevation - (txHeight + rxHeight) / 2;
    let diffractionLoss = 0;
    const wavelength = 3e8 / frequency;
    if (heightDiff > 0 && !isNaN(wavelength) && wavelength > 0) {
        diffractionLoss = 6.9 + 20 * Math.log10(Math.sqrt((heightDiff * heightDiff) / (wavelength * wavelength)));
    }

    const isClear = elevations.every(elevation => {
        const d1 = elevation.distance;
        const d2 = totalDistance - d1;
        const fresnelRadius = Math.sqrt((wavelength * d1 * d2) / totalDistance);
        return elevation.height <= (Math.min(txHeight, rxHeight) + fresnelRadius);
    });

    const effectiveTxPower = txPower + txAntennaGain; // ERP in dBm, no cable loss
    const totalLoss = fspl + terrainLoss + atmosphericLoss + diffractionLoss;
    const receivedPower = effectiveTxPower - totalLoss + rxAntennaGain;
    const snr = receivedPower; // Simplified, assuming 0 dB noise for demo
    const fadeMargin = 15; // Typical fade margin (10–20 dB)

    let linkStatus = '';
    if (receivedPower >= rxSensitivity + fadeMargin) {
        linkStatus = 'Link will work';
    } else if (receivedPower >= rxSensitivity) {
        linkStatus = 'Link may fail due to insufficient margin';
    } else {
        linkStatus = isClear ? 'Link will fail due to insufficient signal' : 'Link will fail due to obstruction';
    }

    const maxAllowableLoss = effectiveTxPower - rxSensitivity - fadeMargin;
    const txPowerWatts = dbmToWatts(txPower);
    const minEffectiveHeight = calculateMinEffectiveHeight(txHeight, frequency / 1e6); // MHz

    const linkBudget = `
        <h3>Link Budget Summary</h3>
        <table>
            <tr><th>Parameter</th><th>Value</th></tr>
            <tr><td>Frequency</td><td>${(frequency / 1e6).toFixed(3)} MHz</td></tr>
            <tr><td>Path Loss (Free Space)</td><td>${fspl.toFixed(1)} dB</td></tr>
            <tr><td>Terrain/Clutter Loss</td><td>${terrainLoss.toFixed(1)} dB</td></tr>
            <tr><td>Atmospheric Loss</td><td>${atmosphericLoss.toFixed(1)} dB</td></tr>
            <tr><td>Diffraction Loss</td><td>${diffractionLoss.toFixed(1)} dB</td></tr>
            <tr><td>Total Loss</td><td>${totalLoss.toFixed(1)} dB</td></tr>
            <tr><td>Transmitter Power</td><td>${txPowerWatts.toFixed(2)} W (${txPower.toFixed(1)} dBm)</td></tr>
            <tr><td>Tx Antenna Gain</td><td>${txAntennaGain.toFixed(1)} dBi</td></tr>
            <tr><td>Effective Radiated Power</td><td>${effectiveTxPower.toFixed(1)} dBm</td></tr>
            <tr><td>Received Power</td><td>${receivedPower.toFixed(1)} dBm</td></tr>
            <tr><td>Rx Antenna Gain</td><td>${rxAntennaGain.toFixed(1)} dBi</td></tr>
            <tr><td>Receiver Sensitivity</td><td>${rxSensitivity} dBm</td></tr>
            <tr><td>SNR</td><td>${snr.toFixed(1)} dB</td></tr>
            <tr><td>Fade Margin</td><td>${fadeMargin} dB</td></tr>
            <tr><td>Max Allowable Loss</td><td>${maxAllowableLoss.toFixed(1)} dB</td></tr>
            <tr><td>Link Status</td><td>${linkStatus}</td></tr>
            <tr><td>Min Effective Height (HF Skywave, m)</td><td>${minEffectiveHeight.toFixed(1)}</td></tr>
            <tr><td>Atmospheric Conditions</td><td>Humidity: ${humidity}%, Temp: ${temperature}°C, Pressure: ${pressure} hPa</td></tr>
        </table>
    `;
    document.getElementById('result').innerHTML = linkBudget;

    updatePolyline(linkStatus === 'Link will work' ? 'green' : linkStatus === 'Link may fail due to insufficient margin' ? 'amber' : 'red');
}

function visualizeFresnelZone(totalDistance, elevations) {
    const frequency = getFrequency();
    const wavelength = 3e8 / frequency;
    const { txHeight, rxHeight } = getAntennaHeights();
    if (isNaN(frequency) || isNaN(totalDistance) || isNaN(txHeight) || isNaN(rxHeight) || elevations.length === 0 || isNaN(wavelength) || wavelength <= 0) {
        document.getElementById('fresnel-zone').style.display = 'none';
        return;
    }

    let svgContent = '';
    let isObstructed = false;

    // Calculate scaling for SVG (150px height, 100% width)
    const maxHeight = Math.max(...elevations.map(e => e.height), txHeight, rxHeight) + 10;
    const heightScale = 150 / maxHeight;
    const numPoints = elevations.length;

    // Draw terrain elevation as a path
    let terrainPath = '';
    elevations.forEach((elevation, i) => {
        const x = (elevation.distance / totalDistance) * 100;
        const y = 150 - (elevation.height * heightScale);
        if (i === 0) terrainPath += `M ${x}% ${y}`;
        else terrainPath += ` L ${x}% ${y}`;
    });

    // Draw Fresnel zone ellipse (n=1, simplified as an ellipse along the path)
    const d1 = totalDistance / 2; // Approximate midpoint for simplicity
    const d2 = totalDistance - d1;
    const fresnelRadius = Math.sqrt((wavelength * d1 * d2) / totalDistance);
    const ellipseHeight = fresnelRadius * heightScale * 2;
    const ellipseY = 150 - (Math.min(txHeight, rxHeight) + fresnelRadius) * heightScale;
    svgContent += `
        <ellipse cx="50%" cy="${ellipseY}" rx="50%" ry="${ellipseHeight / 2}" stroke="black" stroke-width="1" fill="none" />
        <text class="fresnel-label" x="50%" y="${ellipseY - 10}" text-anchor="middle">n=1</text>
    `;

    // Draw line-of-sight (LOS) path
    svgContent += `
        <line x1="0%" y1="${150 - txHeight * heightScale}" x2="100%" y2="${150 - rxHeight * heightScale}" stroke="blue" stroke-width="1" />
    `;

    // Draw terrain path
    svgContent += `<path d="${terrainPath}" fill="none" stroke="gray" stroke-width="2" />`;

    // Add labels for distances and radius
    svgContent += `
        <text class="fresnel-label" x="25%" y="140" text-anchor="middle">d1=${Math.round(d1)}m</text>
        <text class="fresnel-label" x="75%" y="140" text-anchor="middle">d2=${Math.round(d2)}m</text>
        <text class="fresnel-label" x="50%" y="${ellipseY}" text-anchor="middle">r=${fresnelRadius.toFixed(1)}m</text>
        <text class="fresnel-label" x="0%" y="160" text-anchor="start">D=${Math.round(totalDistance)}m</text>
    `;

    // Check for obstructions (terrain above Fresnel clearance)
    elevations.forEach(elevation => {
        const d1 = elevation.distance;
        const d2 = totalDistance - d1;
        const fresnelRadiusP = Math.sqrt((wavelength * d1 * d2) / totalDistance);
        if (elevation.height > Math.min(txHeight, rxHeight) + fresnelRadiusP) {
            isObstructed = true;
            const x = (elevation.distance / totalDistance) * 100;
            const y = 150 - (elevation.height * heightScale);
            svgContent += `<circle cx="${x}%" cy="${y}" r="3" fill="red" />`;
        }
    });

    const svg = `<svg width="100%" height="200" style="position: relative;">${svgContent}</svg>`;
    const fresnelZoneDiv = document.getElementById('fresnel-zone');
    fresnelZoneDiv.innerHTML = svg;
    fresnelZoneDiv.className = isObstructed ? 'fresnel-zone obstructed' : 'fresnel-zone clear';
    fresnelZoneDiv.style.display = 'block';
}

function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'block' : 'none';
    if (!show) {
        const resultDiv = document.getElementById('result');
        if (resultDiv.innerText === 'Loading...') {
            resultDiv.innerText = 'Analysis failed or no data available. Check inputs or try again.';
        }
    }
}

function updatePolyline(color) {
    if (polylineLayer) map.removeLayer(polylineLayer);
    if (transmitter && receiver) {
        polylineLayer = L.polyline([transmitter, receiver], {
            color: color || 'gray',
            className: `polyline-${color}`
        }).addTo(map);
    }
}

function resetLink() {
    transmitter = null;
    receiver = null;
    if (txMarker) map.removeLayer(txMarker);
    if (rxMarker) map.removeLayer(rxMarker);
    if (polylineLayer) map.removeLayer(polylineLayer);
    txMarker = null;
    rxMarker = null;
    polylineLayer = null;
    if (elevationChart) elevationChart.destroy();
    document.getElementById('frequency').value = '30';
    document.getElementById('txHeight').value = '5';
    document.getElementById('rxHeight').value = '5';
    document.getElementById('txPower').value = '1'; // Default to 1 W (30 dBm)
    document.getElementById('rxSensitivity').value = '-90';
    document.getElementById('txAntennaGain').value = '0';
    document.getElementById('rxAntennaGain').value = '0';
    document.getElementById('terrainType').value = 'open';
    document.getElementById('result').innerText = '';
    document.getElementById('elevation-profile').style.display = 'block';
    document.getElementById('elevation-text').style.display = 'none';
    document.getElementById('elevation-container').style.display = 'block';
    document.getElementById('fresnel-zone').style.display = 'none';
    document.getElementById('fresnel-zone').innerHTML = '';
    document.getElementById('map-layer').value = 'street';
    changeMapLayer('street');
    document.getElementById('txBNG').value = '';
    document.getElementById('rxBNG').value = '';
    document.getElementById('locationSearch').value = '';
    document.getElementById('hfFrequency').value = '7';
    document.getElementById('hfAntennaHeight').value = '5';
    document.getElementById('hfTime').value = 'day';
    document.getElementById('hfSolarActivity').value = 'medium';
    document.getElementById('hf-result').innerText = '';
    document.getElementById('pathGranularity').value = 'medium';
    document.getElementById('atmospheric-status').style.display = 'none';
    document.getElementById('atmospheric-status').innerText = '';
    atmosphericData = { humidity: 50, temperature: 15, pressure: 1013 };
    lastAtmosphericUpdate = 0;
    document.querySelector('input[value="click"]').checked = true;
    updatePlacementMode('click');
    document.getElementById('hf-analysis').style.display = 'none';
    alert('Link reset successfully!');
}

function savePath() {
    if (transmitter && receiver) {
        const pathData = {
            transmitter: { lat: transmitter.lat, lng: transmitter.lng, bng: document.getElementById('txBNG').value || null },
            receiver: { lat: receiver.lat, lng: receiver.lng, bng: document.getElementById('rxBNG').value || null },
            frequency: document.getElementById('frequency').value || '30',
            txHeight: document.getElementById('txHeight').value || '5',
            rxHeight: document.getElementById('rxHeight').value || '5',
            txPower: document.getElementById('txPower').value || '1', // Store in watts
            rxSensitivity: document.getElementById('rxSensitivity').value || '-90',
            txAntennaGain: document.getElementById('txAntennaGain').value || '0',
            rxAntennaGain: document.getElementById('rxAntennaGain').value || '0',
            terrainType: document.getElementById('terrainType').value || 'open',
            pathGranularity: document.getElementById('pathGranularity').value || 'medium',
            hfFrequency: document.getElementById('hfFrequency').value || '7',
            hfAntennaHeight: document.getElementById('hfAntennaHeight').value || '5',
            hfTime: document.getElementById('hfTime').value || 'day',
            hfSolarActivity: document.getElementById('hfSolarActivity').value || 'medium',
            atmosphericData: atmosphericData
        };
        localStorage.setItem('rfPath', JSON.stringify(pathData));
        alert('Path saved successfully!');
    } else {
        alert('Select both points before saving.');
    }
}

function loadPath() {
    const pathData = JSON.parse(localStorage.getItem('rfPath') || '{}');
    if (pathData.transmitter && pathData.receiver) {
        map.removeLayer(map.getLayerId(L.marker(transmitter)));
        map.removeLayer(map.getLayerId(L.marker(receiver)));
        if (polylineLayer) map.removeLayer(polylineLayer);
        if (elevationChart) elevationChart.destroy();
        
        transmitter = L.latLng(pathData.transmitter.lat, pathData.transmitter.lng);
        receiver = L.latLng(pathData.receiver.lat, pathData.receiver.lng);
        document.getElementById('frequency').value = pathData.frequency || '30';
        document.getElementById('txHeight').value = pathData.txHeight || '5';
        document.getElementById('rxHeight').value = pathData.rxHeight || '5';
        document.getElementById('txPower').value = pathData.txPower || '1'; // Load in watts
        document.getElementById('rxSensitivity').value = pathData.rxSensitivity || '-90';
        document.getElementById('txAntennaGain').value = pathData.txAntennaGain || '0';
        document.getElementById('rxAntennaGain').value = pathData.rxAntennaGain || '0';
        document.getElementById('terrainType').value = pathData.terrainType || 'open';
        document.getElementById('pathGranularity').value = pathData.pathGranularity || 'medium';
        document.getElementById('txBNG').value = pathData.transmitter.bng || '';
        document.getElementById('rxBNG').value = pathData.receiver.bng || '';
        document.getElementById('locationSearch').value = '';
        document.getElementById('hfFrequency').value = pathData.hfFrequency || '7';
        document.getElementById('hfAntennaHeight').value = pathData.hfAntennaHeight || '5';
        document.getElementById('hfTime').value = pathData.hfTime || 'day';
        document.getElementById('hfSolarActivity').value = pathData.hfSolarActivity || 'medium';
        atmosphericData = pathData.atmosphericData || { humidity: 50, temperature: 15, pressure: 1013 };
        lastAtmosphericUpdate = 0;
        updateAtmosphericStatus();

        txMarker = L.marker(transmitter, { 
            icon: L.icon({
                iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PGNpcmNsZSBjeD0iNSIgY3y9IjUiIHI9IjUiIGZpbGw9ImJsdWUiLz48L3N2Zz4=',
                iconSize: [10, 10],
                iconAnchor: [5, 5],
                popupAnchor: [0, -5]
            }),
            draggable: true 
        }).addTo(map).bindPopup('Transmitter').openPopup();
        rxMarker = L.marker(receiver, { 
            icon: L.icon({
                iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PGNpcmNsZSBjeD0iNSIgY3y9IjUiIHI9IjUiIGZpbGw9InJlZCIvPjwvc3ZnPg==',
                iconSize: [10, 10],
                iconAnchor: [5, 5],
                popupAnchor: [0, -5]
            }),
            draggable: true 
        }).addTo(map).bindPopup('Receiver').openPopup();
        txMarker.on('dragend', onMarkerDrag);
        rxMarker.on('dragend', onMarkerDrag);
        snapToRoad(txMarker);
        snapToRoad(rxMarker);
        updatePolyline('gray');
        analyzePath();
        document.getElementById('elevation-profile').style.display = 'block';
        document.getElementById('elevation-text').style.display = 'none';
        document.getElementById('elevation-container').style.display = 'block';
        document.getElementById('map-layer').value = 'street';
        changeMapLayer('street');
        document.querySelector('input[value="click"]').checked = true;
        updatePlacementMode('click');
        document.getElementById('hf-analysis').style.display = 'none';
        alert('Path loaded successfully!');
    } else {
        alert('No saved path found.');
    }
}

function exportData() {
    if (!transmitter || !receiver) {
        alert('Select both points before exporting.');
        return;
    }
    const pathData = {
        transmitter: { lat: transmitter.lat, lng: transmitter.lng, bng: document.getElementById('txBNG').value || null },
        receiver: { lat: receiver.lat, lng: receiver.lng, bng: document.getElementById('rxBNG').value || null },
        frequency: document.getElementById('frequency').value || '30',
        txHeight: document.getElementById('txHeight').value || '5',
        rxHeight: document.getElementById('rxHeight').value || '5',
        txPower: document.getElementById('txPower').value || '1', // Export in watts
        rxSensitivity: document.getElementById('rxSensitivity').value || '-90',
        txAntennaGain: document.getElementById('txAntennaGain').value || '0',
        rxAntennaGain: document.getElementById('rxAntennaGain').value || '0',
        terrainType: document.getElementById('terrainType').value || 'open',
        pathGranularity: document.getElementById('pathGranularity').value || 'medium',
        hfFrequency: document.getElementById('hfFrequency').value || '7',
        hfAntennaHeight: document.getElementById('hfAntennaHeight').value || '5',
        hfTime: document.getElementById('hfTime').value || 'day',
        hfSolarActivity: document.getElementById('hfSolarActivity').value || 'medium'
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(pathData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "rf_path_config.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    document.body.removeChild(downloadAnchor);
}

function importData() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const pathData = JSON.parse(event.target.result);
                if (pathData.transmitter && pathData.receiver) {
                    map.removeLayer(map.getLayerId(L.marker(transmitter)));
                    map.removeLayer(map.getLayerId(L.marker(receiver)));
                    if (polylineLayer) map.removeLayer(polylineLayer);
                    if (elevationChart) elevationChart.destroy();
                    
                    transmitter = L.latLng(pathData.transmitter.lat, pathData.transmitter.lng);
                    receiver = L.latLng(pathData.receiver.lat, pathData.receiver.lng);
                    document.getElementById('frequency').value = pathData.frequency || '30';
                    document.getElementById('txHeight').value = pathData.txHeight || '5';
                    document.getElementById('rxHeight').value = pathData.rxHeight || '5';
                    document.getElementById('txPower').value = pathData.txPower || '1'; // Import in watts
                    document.getElementById('rxSensitivity').value = pathData.rxSensitivity || '-90';
                    document.getElementById('txAntennaGain').value = pathData.txAntennaGain || '0';
                    document.getElementById('rxAntennaGain').value = pathData.rxAntennaGain || '0';
                    document.getElementById('terrainType').value = pathData.terrainType || 'open';
                    document.getElementById('pathGranularity').value = pathData.pathGranularity || 'medium';
                    document.getElementById('txBNG').value = pathData.transmitter.bng || '';
                    document.getElementById('rxBNG').value = pathData.receiver.bng || '';
                    document.getElementById('locationSearch').value = '';
                    document.getElementById('hfFrequency').value = pathData.hfFrequency || '7';
                    document.getElementById('hfAntennaHeight').value = pathData.hfAntennaHeight || '5';
                    document.getElementById('hfTime').value = pathData.hfTime || 'day';
                    document.getElementById('hfSolarActivity').value = pathData.hfSolarActivity || 'medium';

                    txMarker = L.marker(transmitter, { 
                        icon: L.icon({
                            iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PGNpcmNsZSBjeD0iNSIgY3y9IjUiIHI9IjUiIGZpbGw9ImJsdWUiLz48L3N2Zz4=',
                            iconSize: [10, 10],
                            iconAnchor: [5, 5],
                            popupAnchor: [0, -5]
                        }),
                        draggable: true 
                    }).addTo(map).bindPopup('Transmitter').openPopup();
                    rxMarker = L.marker(receiver, { 
                        icon: L.icon({
                            iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVightPSIxMCI+PGNpcmNsZSBjeD0iNSIgY3y9IjUiIHI9IjUiIGZpbGw9InJlZCIvPjwvc3ZnPg==',
                            iconSize: [10, 10],
                            iconAnchor: [5, 5],
                            popupAnchor: [0, -5]
                        }),
                        draggable: true 
                    }).addTo(map).bindPopup('Receiver').openPopup();
                    txMarker.on('dragend', onMarkerDrag);
                    rxMarker.on('dragend', onMarkerDrag);
                    snapToRoad(txMarker);
                    snapToRoad(rxMarker);
                    updatePolyline('gray');
                    analyzePath();
                    document.getElementById('elevation-profile').style.display = 'block';
                    document.getElementById('elevation-text').style.display = 'none';
                    document.getElementById('elevation-container').style.display = 'block';
                    document.getElementById('map-layer').value = 'street';
                    changeMapLayer('street');
                    document.querySelector('input[value="click"]').checked = true;
                    updatePlacementMode('click');
                    document.getElementById('hf-analysis').style.display = 'none';
                    alert('Path imported successfully!');
                } else {
                    alert('Invalid path data format.');
                }
            } catch (error) {
                console.error('Error importing data:', error);
                alert(`Error importing data: ${error.message}`);
            }
        };
        reader.readAsText(file);
    };
    fileInput.click();
}

// Tooltips and help modal
document.querySelectorAll('.tooltip').forEach(tooltip => {
    tooltip.addEventListener('mouseover', () => {
        const tooltipText = tooltip.getAttribute('data-tooltip');
        tooltip.setAttribute('title', tooltipText);
    });
    tooltip.addEventListener('mouseout', () => {
        tooltip.removeAttribute('title');
    });
});

function showHelp() {
    document.getElementById('help-modal').style.display = 'block';
}

function closeHelp() {
    document.getElementById('help-modal').style.display = 'none';
}

function showHFAnalysis() {
    const hfSection = document.getElementById('hf-analysis');
    hfSection.style.display = hfSection.style.display === 'none' ? 'block' : 'none';
    if (hfSection.style.display === 'block') {
        window.scrollTo({ top: hfSection.offsetTop, behavior: 'smooth' });
    }
}

function analyzeHF() {
    const frequencyMHz = parseFloat(document.getElementById('hfFrequency').value) || 7;
    const antennaHeight = parseFloat(document.getElementById('hfAntennaHeight').value) || 5;
    const time = document.getElementById('hfTime').value;
    const solarActivity = document.getElementById('hfSolarActivity').value;

    if (isNaN(frequencyMHz) || frequencyMHz < 3 || frequencyMHz > 30) {
        alert('Invalid HF frequency. Must be between 3 and 30 MHz.');
        return;
    }
    if (isNaN(antennaHeight) || antennaHeight <= 0) {
        alert('Invalid antenna height. Must be a positive value in meters.');
        return;
    }

    const minEffectiveHeight = calculateMinEffectiveHeight(antennaHeight, frequencyMHz);
    const { luf, fot, muf } = calculateHFWorkingFrequencies(frequencyMHz, time, solarActivity);

    const hfResult = `
        <h3>HF Analysis Results</h3>
        <table>
            <tr><th>Parameter</th><th>Value</th></tr>
            <tr><td>Frequency</td><td>${frequencyMHz.toFixed(1)} MHz</td></tr>
            <tr><td>Antenna Height</td><td>${antennaHeight.toFixed(1)} m</td></tr>
            <tr><td>Min Effective Height (Skywave)</td><td>${minEffectiveHeight.toFixed(1)} m</td></tr>
            <tr><td>Lowest Usable Frequency (LUF)</td><td>${luf.toFixed(1)} MHz</td></tr>
            <tr><td>Frequency of Optimum Transmission (FOT)</td><td>${fot.toFixed(1)} MHz</td></tr>
            <tr><td>Maximum Usable Frequency (MUF)</td><td>${muf.toFixed(1)} MHz</td></tr>
        </table>
        <p><strong>Notes:</strong> Results are approximate and depend on ionospheric conditions, which vary by time, season, and solar activity. Adjust inputs for more accurate predictions.</p>
    `;
    document.getElementById('hf-result').innerHTML = hfResult;
}

// Calculate minimum effective height for HF skywave propagation
function calculateMinEffectiveHeight(antennaHeight, frequencyMHz) {
    const wavelengthMeters = 300 / frequencyMHz; // Speed of light (m/s) / frequency (MHz) = wavelength (m)
    const minHeight = Math.max(antennaHeight, 0.1 * wavelengthMeters); // Minimum 0.1 wavelength, but not less than current height
    return minHeight;
}

// Calculate HF working frequencies (LUF, FOT, MUF)
function calculateHFWorkingFrequencies(frequencyMHz, time, solarActivity) {
    let mufBase = 0;
    switch (solarActivity) {
        case 'low': mufBase = 15; break;
        case 'medium': mufBase = 25; break;
        case 'high': mufBase = 35; break;
        default: mufBase = 25;
    }

    if (time === 'night') mufBase *= 0.7; // Night reduces MUF
    else mufBase *= 1.0; // Day maintains higher MUF

    const muf = Math.min(mufBase, 30); // Cap at 30 MHz (HF upper limit)
    const luf = Math.max(3, muf * 0.3); // LUF typically 30% of MUF, but not below 3 MHz
    const fot = muf * 0.85; // FOT is ~85% of MUF for optimum transmission

    return { luf, fot, muf };
}

// Search for a location and center the map
async function searchLocation() {
    const location = document.getElementById('locationSearch').value.trim();
    if (!location) {
        alert('Please enter a location or BNG reference.');
        return;
    }

    showLoading(true);
    try {
        let latLon;
        if (/^[A-Z]{2}\d{6,8}$/.test(location.toUpperCase())) {
            latLon = bngToLatLon(location);
            if (!latLon) {
                showLoading(false);
                return;
            }
        } else {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`);
            if (!response.ok) throw new Error(`Geocoding failed with status ${response.status}`);
            const data = await response.json();
            if (!data || data.length === 0) throw new Error('Location not found.');
            latLon = L.latLng(data[0].lat, data[0].lon);
        }

        map.setView(latLon, 13);
        showLoading(false);
        alert(`Map centered on ${location}`);
    } catch (error) {
        console.error('Error searching location:', error);
        alert(`Error finding location: ${error.message}. Check the input and try again.`);
        showLoading(false);
    }
}

// Update atmospheric conditions from OpenWeatherMap
async function updateAtmosphericConditions() {
    if (!transmitter || !receiver) {
        alert('Place both transmitter and receiver points to fetch atmospheric conditions.');
        return;
    }

    const now = Date.now();
    if (now - lastAtmosphericUpdate < 1800000) { // 30 minutes in milliseconds
        updateAtmosphericStatus();
        return;
    }

    showLoading(true);
    try {
        const lat = transmitter.lat;
        const lon = transmitter.lng;
        const apiKey = 'YOUR_API_KEY'; // Replace with your OpenWeatherMap API key
        const response = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`);
        if (!response.ok) throw new Error(`Weather API failed with status ${response.status}`);
        const data = await response.json();

        atmosphericData = {
            humidity: data.main.humidity || 50,
            temperature: data.main.temp || 15,
            pressure: data.main.pressure || 1013
        };
        lastAtmosphericUpdate = now;
        updateAtmosphericStatus();
        analyzePath(); // Re-analyze with updated conditions
        showLoading(false);
    } catch (error) {
        console.error('Error fetching atmospheric conditions:', error);
        alert(`Error updating atmospheric conditions: ${error.message}. Using default values (Humidity: 50%, Temp: 15°C, Pressure: 1013 hPa).`);
        atmosphericData = { humidity: 50, temperature: 15, pressure: 1013 };
        lastAtmosphericUpdate = 0;
        updateAtmosphericStatus();
        showLoading(false);
    }
}

// Update atmospheric status display
function updateAtmosphericStatus() {
    const status = `Current Atmospheric Conditions: Humidity: ${atmosphericData.humidity}%, Temp: ${atmosphericData.temperature}°C, Pressure: ${atmosphericData.pressure} hPa`;
    document.getElementById('atmospheric-status').innerText = status;
    document.getElementById('atmospheric-status').style.display = 'block';
}

// Initialize map and UI on page load
document.addEventListener('DOMContentLoaded', () => {
    try {
        initMap();
        const helpButton = document.createElement('button');
        helpButton.textContent = 'Help';
        helpButton.onclick = showHelp;
        helpButton.className = 'help-button';
        document.querySelector('.controls').appendChild(helpButton);
    } catch (error) {
        console.error('Error initializing map:', error);
        document.getElementById('map').innerHTML = '<p>Error: Failed to initialize map. Check console for details.</p>';
    }

    // Real-time validation for inputs
    ['frequency', 'txHeight', 'rxHeight', 'txPower', 'rxSensitivity', 'hfFrequency', 'hfAntennaHeight', 
     'txAntennaGain', 'rxAntennaGain', 'terrainType'].forEach(id => {
        const input = document.getElementById(id);
        input.addEventListener('input', () => {
            const value = parseFloat(input.value) || 0;
            if (id === 'frequency' && !((value >= 30 && value <= 87.975) || (value >= 225 && value <= 450))) {
                input.classList.add('invalid');
                input.title = 'Frequency must be between 30-87.975 MHz or 225-450 MHz';
            } else if ((id === 'txHeight' || id === 'rxHeight' || id === 'hfAntennaHeight') && value < 0) {
                input.classList.add('invalid');
                input.title = 'Height must be positive';
            } else if (id === 'txPower' && (isNaN(value) || value <= 0)) {
                input.classList.add('invalid');
                input.title = 'Transmitter power must be a positive value in watts';
            } else if (id === 'rxSensitivity' && isNaN(value)) {
                input.classList.add('invalid');
                input.title = 'Receiver sensitivity must be a valid number in dBm';
            } else if (id === 'hfFrequency' && (isNaN(value) || value < 3 || value > 30)) {
                input.classList.add('invalid');
                input.title = 'HF frequency must be between 3 and 30 MHz';
            } else if ((id === 'txAntennaGain' || id === 'rxAntennaGain') && (isNaN(value) || value < -10 || value > 30)) {
                input.classList.add('invalid');
                input.title = 'Antenna gain must be between -10 and 30 dBi';
            } else if (id === 'terrainType' && !['open', 'hilly', 'urban', 'forest'].includes(value)) {
                input.classList.add('invalid');
                input.title = 'Invalid terrain type. Choose from open, hilly, urban, or forest';
            } else {
                input.classList.remove('invalid');
                input.title = ''; // Clear any error message for valid input
            }
        });
    });

    // Add event listeners for buttons and inputs
    document.getElementById('analyzeButton').addEventListener('click', analyzePath);
    document.getElementById('resetButton').addEventListener('click', resetLink);
    document.getElementById('saveButton').addEventListener('click', savePath);
    document.getElementById('loadButton').addEventListener('click', loadPath);
    document.getElementById('exportButton').addEventListener('click', exportData);
    document.getElementById('importButton').addEventListener('click', importData);
    document.getElementById('searchButton').addEventListener('click', searchLocation);
    document.getElementById('hfAnalyzeButton').addEventListener('click', analyzeHF);
    document.getElementById('showHFAnalysis').addEventListener('click', showHFAnalysis);

    // Handle map layer change
    document.getElementById('map-layer').addEventListener('change', (e) => {
        changeMapLayer(e.target.value);
    });

    // Handle placement mode change (radio buttons)
    document.querySelectorAll('input[name="placementMode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            updatePlacementMode(e.target.value);
        });
    });

    // Initialize atmospheric conditions display
    updateAtmosphericStatus();

    // Load saved path on startup if available
    if (localStorage.getItem('rfPath')) {
        loadPath();
    }
});

// Handle window resize for responsive chart and map
window.addEventListener('resize', () => {
    if (elevationChart) {
        elevationChart.resize();
    }
    if (map) {
        map.invalidateSize();
    }
});

// Ensure Chart.js is loaded or provide a fallback
if (typeof Chart === 'undefined') {
    console.warn('Chart.js not loaded. Elevation charts will display as text only.');
}