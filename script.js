// Global variables
let map, transmitter, receiver, polylineLayer = null, txMarker = null, rxMarker = null, elevationChart = null, streetLayer, satelliteLayer, topoLayer, placementMode = 'click';
let atmosphericData = { humidity: 50, temperature: 15, pressure: 1013 };
let lastAtmosphericUpdate = 0;
let relayMarkers = []; // Track relay markers for removal
let transmitterGroundElevation = 0; // Default to 0 m if not set
let receiverGroundElevation = 0;    // Default to 0 m if not set

// Initialize the map
function initMap() {
    console.log('Initializing map...');
    try {
        map = L.map('map').setView([51.505, -0.09], 13);
        map.obstructionLayers = []; // Initialize obstruction layers array

        streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        });

        satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: 'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
        });

        topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            maxZoom: 17, // OpenTopoMap max zoom is 17
            attribution: 'Map data: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
        });

        streetLayer.addTo(map); // Default layer

        // Ensure click listener is properly set up
        if (map) {
            console.log('Map initialized, attaching click listener...');
            map.off('click'); // Clear any existing click listeners
            map.on('click', async (e) => {
                console.log('Map clicked at:', e.latlng); // Debug log
                console.log('Current placementMode:', placementMode);
                if (placementMode === 'click') {
                    showLoading(true); // Show loading indicator
                    const elevation = await getSingleElevation(e.latlng);
                    console.log(`Elevation at click: ${elevation}m`);
                    if (!transmitter && confirm('Place transmitter at this location?')) {
                        transmitter = e.latlng;
                        txMarker = L.marker(transmitter, { 
                            icon: L.icon({
                                iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PHJlY3QgeD0iMCIgeT0iMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSJibHVlIi8+PC9zdmc+',
                                iconSize: [10, 10],
                                iconAnchor: [5, 5],
                                popupAnchor: [0, -5]
                            }),
                            draggable: true 
                        }).addTo(map).bindPopup(`Transmitter<br>Elevation: ${elevation}m`).openPopup();
                        txMarker.on('dragend', onMarkerDrag);
                        console.log(`Transmitter placed at: Lat ${transmitter.lat}, Lon ${transmitter.lng}`);
                        updateAtmosphericConditions();
                        showLoading(false); // Hide loading indicator after placement
                    } else if (!receiver && confirm('Place receiver at this location?')) {
                        receiver = e.latlng;
                        rxMarker = L.marker(receiver, { 
                            icon: L.icon({
                                iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PHJlY3QgeD0iMCIgeT0iMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSJyZWQiLz4+PC9zdmc+',
                                iconSize: [10, 10],
                                iconAnchor: [5, 5],
                                popupAnchor: [0, -5]
                            }),
                            draggable: true 
                        }).addTo(map).bindPopup(`Receiver<br>Elevation: ${elevation}m`).openPopup();
                        rxMarker.on('dragend', onMarkerDrag);
                        console.log(`Receiver placed at: Lat ${receiver.lat}, Lon ${receiver.lng}`);
                        if (polylineLayer) map.removeLayer(polylineLayer);
                        updatePolyline();
                        analyzePath();
                        showLoading(false); // Hide loading indicator after placement
                    } else if (confirm('Reset and place new transmitter at this location?')) {
                        map.removeLayer(txMarker);
                        map.removeLayer(rxMarker);
                        if (polylineLayer) map.removeLayer(polylineLayer);
                        transmitter = e.latlng;
                        receiver = null;
                        txMarker = L.marker(transmitter, { 
                            icon: L.icon({
                                iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PHJlY3QgeD0iMCIgeT0iMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSJibHVlIi8+PC9zdmc+',
                                iconSize: [10, 10],
                                iconAnchor: [5, 5],
                                popupAnchor: [0, -5]
                            }),
                            draggable: true 
                        }).addTo(map).bindPopup(`Transmitter<br>Elevation: ${elevation}m`).openPopup();
                        txMarker.on('dragend', onMarkerDrag);
                        console.log(`Reset and placed Transmitter at: Lat ${transmitter.lat}, Lon ${transmitter.lng}`);
                        rxMarker = null;
                        updatePolyline();
                        updateAtmosphericConditions();
                        showLoading(false); // Hide loading indicator after placement
                    } else {
                        console.log('Click canceled by user');
                        showLoading(false); // Hide loading indicator if canceled
                    }
                } else {
                    console.log('Click ignored: Not in click mode');
                }
            });
        } else {
            console.error('Map not initialized in initMap');
        }

        L.control.zoom({ position: 'topright' }).addTo(map);
        L.control.scale().addTo(map);
    } catch (error) {
        console.error('Error in initMap:', error);
    }
}

// Update placement mode
function updatePlacementMode(mode) {
    console.log('Updating placement mode to:', mode);
    placementMode = mode;
    const bngGroup = document.getElementById('bng-group');
    const coordGroup = document.getElementById('coord-group');
    if (bngGroup && coordGroup) {
        bngGroup.style.display = mode === 'bng' ? 'block' : 'none';
        coordGroup.style.display = mode === 'coords' ? 'block' : 'none';
    } else {
        console.warn('BNG or Coord group not found in DOM');
    }
    if (map) { // Ensure map exists
        map.off('click'); // Clear any existing click listeners
        if (mode === 'click') {
            console.log('Attaching click listener for click mode...');
            map.on('click', async (e) => {
                console.log('Map clicked in click mode at:', e.latlng); // Debug log
                showLoading(true); // Show loading indicator
                const elevation = await getSingleElevation(e.latlng);
                console.log(`Elevation at click: ${elevation}m`);
                if (!transmitter && confirm('Place transmitter at this location?')) {
                    transmitter = e.latlng;
                    txMarker = L.marker(transmitter, { 
                        icon: L.icon({
                            iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PHJlY3QgeD0iMCIgeT0iMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSJibHVlIi8+PC9zdmc+',
                            iconSize: [10, 10],
                            iconAnchor: [5, 5],
                            popupAnchor: [0, -5]
                        }),
                        draggable: true 
                    }).addTo(map).bindPopup(`Transmitter<br>Elevation: ${elevation}m`).openPopup();
                    txMarker.on('dragend', onMarkerDrag);
                    console.log(`Transmitter placed at: Lat ${transmitter.lat}, Lon ${transmitter.lng}`);
                    updateAtmosphericConditions();
                    showLoading(false); // Hide loading indicator after placement
                } else if (!receiver && confirm('Place receiver at this location?')) {
                    receiver = e.latlng;
                    rxMarker = L.marker(receiver, { 
                        icon: L.icon({
                            iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PHJlY3QgeD0iMCIgeT0iMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSJyZWQiLz4+PC9zdmc+',
                            iconSize: [10, 10],
                            iconAnchor: [5, 5],
                            popupAnchor: [0, -5]
                        }),
                        draggable: true 
                    }).addTo(map).bindPopup(`Receiver<br>Elevation: ${elevation}m`).openPopup();
                    rxMarker.on('dragend', onMarkerDrag);
                    console.log(`Receiver placed at: Lat ${receiver.lat}, Lon ${receiver.lng}`);
                    if (polylineLayer) map.removeLayer(polylineLayer);
                    updatePolyline();
                    analyzePath();
                    showLoading(false); // Hide loading indicator after placement
                } else if (confirm('Reset and place new transmitter at this location?')) {
                    map.removeLayer(txMarker);
                    map.removeLayer(rxMarker);
                    if (polylineLayer) map.removeLayer(polylineLayer);
                    transmitter = e.latlng;
                    receiver = null;
                    txMarker = L.marker(transmitter, { 
                        icon: L.icon({
                            iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PHJlY3QgeD0iMCIgeT0iMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSJibHVlIi8+PC9zdmc+',
                            iconSize: [10, 10],
                            iconAnchor: [5, 5],
                            popupAnchor: [0, -5]
                        }),
                        draggable: true 
                    }).addTo(map).bindPopup(`Transmitter<br>Elevation: ${elevation}m`).openPopup();
                    txMarker.on('dragend', onMarkerDrag);
                    console.log(`Reset and placed Transmitter at: Lat ${transmitter.lat}, Lon ${transmitter.lng}`);
                    rxMarker = null;
                    updatePolyline();
                    updateAtmosphericConditions();
                    showLoading(false); // Hide loading indicator after placement
                } else {
                    console.log('Click canceled by user');
                    showLoading(false); // Hide loading indicator if canceled
                }
            });
        } else {
            console.log('Click listener removed for non-click mode');
        }
    } else {
        console.error('Map not initialized in updatePlacementMode');
    }
}

// Switch map layers
function changeMapLayer(layer) {
    if (!map) {
        console.error('Map not initialized.');
        return;
    }
    map.eachLayer((layerObj) => {
        if (layerObj instanceof L.TileLayer) {
            map.removeLayer(layerObj);
        }
    });
    console.log('Switching to layer:', layer); // Debug log to confirm trigger
    if (layer === 'street') {
        streetLayer.addTo(map);
    } else if (layer === 'satellite') {
        satelliteLayer.addTo(map);
    } else if (layer === 'topo') {
        topoLayer.addTo(map);
    } else {
        console.warn('Unknown layer type:', layer);
        streetLayer.addTo(map); // Default fallback
    }
}

// Convert BNG to lat/lon
function bngToLatLon(bng) {
    bng = bng.toUpperCase().trim();
    if (!/^[A-Z]{2}\d{6,8}$/.test(bng)) {
        alert('Invalid BNG reference. Use format like TQ123456 (6 or 8 digits).');
        return null;
    }
    const square = bng.substring(0, 2);
    const digits = bng.substring(2);
    const easting = parseInt(digits.substring(0, digits.length / 2));
    const northing = parseInt(digits.substring(digits.length / 2));
    const squareCoords = {
        'TQ': { east: 500000, north: 100000 }, // Existing TQ
        'SU': { east: 400000, north: 100000 }, // Add SU (Southampton/Windsor area)
        'TL': { east: 500000, north: 200000 }, // Add TL (Cambridge/London area)
        'SP': { east: 400000, north: 200000 }, // Add SP (Oxford/Birmingham area)
        // Add more squares as needed (e.g., 'ST', 'SY', 'SZ', etc.)
    };
    if (!squareCoords[square]) {
        alert('Unsupported BNG square. Use TQ, SU, TL, SP, etc. for now.');
        return null;
    }
    let precision = digits.length === 8 ? 10 : 100;
    const fullEasting = squareCoords[square].east + easting * precision;
    const fullNorthing = squareCoords[square].north + northing * precision;
    const lat = (fullNorthing / 100000) * 0.9 + 49.5;
    const lon = (fullEasting / 100000) * 1.2 - 0.5;
    return L.latLng(lat, lon);
}

// Place marker from BNG
function placeFromBNG(type) {
    const bngInput = type === 'transmitter' ? document.getElementById('txBNG') : document.getElementById('rxBNG');
    const bng = bngInput.value;
    const latLon = bngToLatLon(bng);
    if (!latLon) return;

    if (type === 'transmitter' && confirm('Place transmitter at this BNG location?')) {
        if (txMarker) map.removeLayer(txMarker);
        transmitter = latLon;
        txMarker = L.marker(transmitter, { 
            icon: L.icon({
                iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PHJlY3QgeD0iMCIgeT0iMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSJibHVlIi8+PC9zdmc+',
                iconSize: [10, 10],
                iconAnchor: [5, 5],
                popupAnchor: [0, -5]
            }),
            draggable: true 
        }).addTo(map).bindPopup('Transmitter').openPopup();
        txMarker.on('dragend', onMarkerDrag);
        updateAtmosphericConditions();
    } else if (type === 'receiver' && confirm('Place receiver at this BNG location?')) {
        if (rxMarker) map.removeLayer(rxMarker);
        receiver = latLon;
        rxMarker = L.marker(receiver, { 
            icon: L.icon({
                iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PHJlY3QgeD0iMCIgeT0iMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSJyZWQiLz4+PC9zdmc+',
                iconSize: [10, 10],
                iconAnchor: [5, 5],
                popupAnchor: [0, -5]
            }),
            draggable: true 
        }).addTo(map).bindPopup('Receiver').openPopup();
        rxMarker.on('dragend', onMarkerDrag);
        if (polylineLayer) map.removeLayer(polylineLayer);
        updatePolyline();
        analyzePath();
    }
}

// Place marker from coordinates
async function placeFromCoords(type) {
    const latInput = type === 'transmitter' ? document.getElementById('txLat') : document.getElementById('rxLat');
    const lngInput = type === 'transmitter' ? document.getElementById('txLng') : document.getElementById('rxLng');
    const lat = parseFloat(latInput.value);
    const lng = parseFloat(lngInput.value);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        alert('Invalid coordinates. Latitude must be -90 to 90, Longitude -180 to 180.');
        return;
    }
    const latLng = L.latLng(lat, lng);
    const elevation = await getSingleElevation(latLng);

    if (type === 'transmitter' && confirm('Place transmitter at these coordinates?')) {
        if (txMarker) map.removeLayer(txMarker);
        transmitter = latLng;
        txMarker = L.marker(transmitter, { 
            icon: L.icon({
                iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PHJlY3QgeD0iMCIgeT0iMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSJibHVlIi8+PC9zdmc+',
                iconSize: [10, 10],
                iconAnchor: [5, 5],
                popupAnchor: [0, -5]
            }),
            draggable: true 
        }).addTo(map).bindPopup(`Transmitter<br>Elevation: ${elevation}m`).openPopup();
        txMarker.on('dragend', onMarkerDrag);
        updateAtmosphericConditions();
    } else if (type === 'receiver' && confirm('Place receiver at these coordinates?')) {
        if (rxMarker) map.removeLayer(rxMarker);
        receiver = latLng;
        rxMarker = L.marker(receiver, { 
            icon: L.icon({
                iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGViZ2h0PSIxMCI+PHJlY3QgeD0iMCIgeT0iMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSJyZWQiLz4+PC9zdmc+',
                iconSize: [10, 10],
                iconAnchor: [5, 5],
                popupAnchor: [0, -5]
            }),
            draggable: true 
        }).addTo(map).bindPopup(`Receiver<br>Elevation: ${elevation}m`).openPopup();
        rxMarker.on('dragend', onMarkerDrag);
        if (polylineLayer) map.removeLayer(polylineLayer);
        updatePolyline();
        analyzePath();
    }
}

// Handle marker dragging for transmitter and receiver
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
        updatePolyline();
        analyzePath();
        updateAtmosphericConditions();
    }
}

// Fetch single-point elevation
async function getSingleElevation(latlng) {
    try {
        const response = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${latlng.lat},${latlng.lng}`);
        const data = await response.json();
        if (data.results && data.results.length > 0 && data.results[0].elevation !== undefined) {
            const elevation = data.results[0].elevation.toFixed(1);
            console.log('Elevation fetched:', { latlng, elevation });
            if (!transmitter) {
                transmitterGroundElevation = parseFloat(elevation);
                console.log('Set transmitterGroundElevation:', transmitterGroundElevation);
            } else if (!receiver) {
                receiverGroundElevation = parseFloat(elevation);
                console.log('Set receiverGroundElevation:', receiverGroundElevation);
            }
            return elevation;
        }
        return 'N/A';
    } catch (error) {
        console.error('Error fetching elevation:', error);
        return 'N/A';
    }
}

// Fetch elevation data for path
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
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) {
            if (response.status === 429 && retries > 0) {
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
                elevations.push({ distance: i * stepDistance, height: result.elevation, lat: parseFloat(coords[i].split(',')[0]), lon: parseFloat(coords[i].split(',')[1]) });
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
            alert('Elevation data request timed out.');
        } else if (retries > 0 && error.message.includes('429')) {
            console.warn('Retrying due to rate limit...');
            return await fetchElevationData(tx, rx, numPoints, retries - 1);
        } else {
            console.error('Error fetching elevation:', error);
            alert(`Error fetching elevation data: ${error.message}.`);
        }
        return [];
    }
}

// Get frequency
function getFrequency() {
    const freqInput = document.getElementById('frequency').value;
    const freqMHz = parseFloat(freqInput) || 30;
    if (isNaN(freqMHz)) {
        alert('Invalid frequency value. Defaulting to 30 MHz.');
        document.getElementById('frequency').value = '30';
        document.getElementById('frequency').classList.remove('invalid');
        return 30 * 1e6;
    }
    if ((freqMHz >= 30 && freqMHz <= 87.975) || (freqMHz >= 225 && freqMHz <= 450)) {
        document.getElementById('frequency').classList.remove('invalid');
        return freqMHz * 1e6;
    }
    alert('Frequency must be between 30-87.975 MHz or 225-450 MHz. Defaulting to 30 MHz.');
    document.getElementById('frequency').classList.remove('invalid');
    document.getElementById('frequency').value = '30';
    return 30 * 1e6;
}

// Get antenna heights
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

// Get link parameters
function getLinkParameters() {
    const txPowerInput = document.getElementById('txPower').value;
    const rxSensitivityInput = document.getElementById('rxSensitivity').value;
    const txAntennaGain = parseFloat(document.getElementById('txAntennaGain').value) || 0;
    const rxAntennaGain = parseFloat(document.getElementById('rxAntennaGain').value) || 0;
    const txPowerWatts = parseFloat(txPowerInput) || 1;
    const rxSensitivity = parseFloat(rxSensitivityInput) || -90;

    if (isNaN(txPowerWatts) || txPowerWatts <= 0) {
        alert('Invalid transmitter power. Defaulting to 1 W (30 dBm).');
        document.getElementById('txPower').value = '1';
        document.getElementById('txPower').classList.remove('invalid');
        return { txPower: 30, rxSensitivity: -90, txAntennaGain: 0, rxAntennaGain: 0 };
    }
    if (isNaN(rxSensitivity)) {
        alert('Invalid receiver sensitivity. Defaulting to -90 dBm.');
        document.getElementById('rxSensitivity').value = '-90';
        document.getElementById('rxSensitivity').classList.remove('invalid');
        return { txPower: wattsToDbm(txPowerWatts), rxSensitivity: -90, txAntennaGain, rxAntennaGain };
    }
    if (isNaN(txAntennaGain) || txAntennaGain < -10 || txAntennaGain > 30) {
        alert('Invalid transmitter antenna gain. Defaulting to 0 dBi.');
        document.getElementById('txAntennaGain').value = '0';
        document.getElementById('txAntennaGain').classList.remove('invalid');
        txAntennaGain = 0;
    }
    if (isNaN(rxAntennaGain) || rxAntennaGain < -10 || rxAntennaGain > 30) {
        alert('Invalid receiver antenna gain. Defaulting to 0 dBi.');
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
    return 10 * Math.log10(watts * 1000);
}

// Convert dBm to watts
function dbmToWatts(dbm) {
    return Math.pow(10, (dbm - 30) / 10);
}

// Analyze the path
async function analyzePath() {
    let linkStatus = 'Error'; // Default status
    let elevations = [];
    let totalDistance = 0;
    let relaySites = relayMarkers.map(marker => ({
        latLng: marker.getLatLng(),
        elevation: parseFloat(marker.getPopup().getContent().match(/Elevation: ([\d.]+)m/)[1] || 0)
    })); // Always use current relay positions

    if (!map || !transmitter || !receiver) {
        document.getElementById('result').innerText = 'Map or points not initialized. Select both points first.';
        document.getElementById('fresnel-zone').style.display = 'none';
        document.getElementById('elevation-text').style.display = 'none';
        if (elevationChart) elevationChart.destroy();
        updatePolyline('gray');
        return { linkStatus, elevations, totalDistance, relaySites };
    }

    totalDistance = transmitter.distanceTo(receiver);
    if (isNaN(totalDistance) || totalDistance <= 0) {
        document.getElementById('result').innerText = 'Invalid path distance';
        document.getElementById('fresnel-zone').style.display = 'none';
        document.getElementById('elevation-text').style.display = 'none';
        if (elevationChart) elevationChart.destroy();
        updatePolyline('gray');
        return { linkStatus, elevations, totalDistance, relaySites };
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
        elevations = await fetchElevationData(transmitter, receiver, numPoints);
        if (elevations.length === 0) {
            document.getElementById('result').innerText = 'Failed to fetch elevation data';
            document.getElementById('fresnel-zone').style.display = 'none';
            document.getElementById('elevation-text').style.display = 'none';
            if (elevationChart) elevationChart.destroy();
            linkStatus = 'Error';
        } else {
            console.log('Ground Elevations:', {
                transmitterGroundElevation: transmitterGroundElevation || 0,
                receiverGroundElevation: receiverGroundElevation || 0
            });
            console.log('Chart Data - Elevations:', elevations);
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
                                const txGround = transmitterGroundElevation || 0;
                                const rxGround = receiverGroundElevation || 0;
                                const txClearance = txGround + txHeight + fresnelRadius;
                                const rxClearance = rxGround + rxHeight + fresnelRadius;
                                return Math.min(txClearance, rxClearance);
                            }),
                            borderColor: 'purple',
                            fill: false,
                            tension: 0.1
                        }, {
                            label: 'Min Effective Height (HF Skywave, m)',
                            data: elevations.map(() => {
                                const { txHeight } = getAntennaHeights();
                                return calculateMinEffectiveHeight(txHeight, getFrequency() / 1e6);
                            }),
                            borderColor: 'orange',
                            fill: false,
                            tension: 0.1,
                            borderDash: [5, 5]
                        }, {
                            label: 'Relay Sites',
                            type: 'scatter',
                            data: relaySites.map(site => ({
                                x: transmitter.distanceTo(site.latLng),
                                y: site.elevation
                            })),
                            backgroundColor: 'purple',
                            borderColor: 'purple',
                            pointRadius: 5,
                            pointHoverRadius: 7
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: { beginAtZero: true, title: { display: true, text: 'Height (m)' }, min: 0 },
                            x: { title: { display: true, text: 'Distance (m)' } }
                        },
                        plugins: {
                            legend: { position: 'top' }
                        }
                    }
                });
                document.getElementById('elevation-text').style.display = 'none';
                document.getElementById('elevation-profile').style.display = 'block';
            }

            const result = calculateRF(totalDistance, elevations);
            linkStatus = result.linkStatus;
            visualizeFresnelZone(totalDistance, elevations);
        }
    } catch (fetchError) {
        console.error('Error in fetch process:', fetchError);
        document.getElementById('result').innerText = `Error fetching or processing data: ${fetchError.message}`;
        linkStatus = 'Error';
        document.getElementById('fresnel-zone').style.display = 'none';
        document.getElementById('elevation-text').style.display = 'none';
        if (elevationChart) elevationChart.destroy();
    }

    // Always update polyline with final linkStatus
    const polylineColor = linkStatus === 'Link will work' ? 'green' : 
                         linkStatus === 'Link may fail due to insufficient margin' ? 'amber' : 
                         'red';
    updatePolyline(polylineColor);
    console.log(`analyzePath completed. Link Status: ${linkStatus}, Polyline Color: ${polylineColor}`);

    return { linkStatus, elevations, totalDistance, relaySites };
}

// Calculate RF link budget
function calculateRF(totalDistance, elevations) {
    const frequency = getFrequency();
    const { txHeight, rxHeight } = getAntennaHeights();
    const { txPower, rxSensitivity, txAntennaGain, rxAntennaGain } = getLinkParameters();
    const terrainType = document.getElementById('terrainType').value;
    const { humidity, temperature, pressure } = atmosphericData;

    console.log('Calculating RF Link Budget:', {
        frequency: frequency / 1e6 + ' MHz',
        totalDistance: totalDistance + ' m',
        txHeight, rxHeight,
        txPower, rxSensitivity,
        txAntennaGain, rxAntennaGain,
        terrainType, atmosphericData
    });

    if (isNaN(frequency) || isNaN(totalDistance) || isNaN(txHeight) || isNaN(rxHeight) || 
        isNaN(txPower) || isNaN(rxSensitivity) || isNaN(txAntennaGain) || isNaN(rxAntennaGain) || 
        isNaN(humidity) || isNaN(temperature) || isNaN(pressure) || elevations.length === 0) {
        throw new Error('Invalid input values or elevation data');
    }

    const fspl = 20 * Math.log10(totalDistance) + 20 * Math.log10(frequency) + 20 * Math.log10(4 * Math.PI / 3e8);
    console.log('FSPL:', fspl.toFixed(2) + ' dB');

    let terrainLoss = 0;
    switch (terrainType) {
        case 'open': terrainLoss = 0; break;
        case 'hilly': terrainLoss = 2; break;
        case 'urban': terrainLoss = 6; break;
        case 'forest': terrainLoss = 8; break;
        default: terrainLoss = 0;
    }
    terrainLoss *= (totalDistance / 1000);
    console.log('Terrain Loss:', terrainLoss.toFixed(2) + ' dB');

    let atmosphericLoss = 0;
    if (frequency / 1e6 <= 30) {
        atmosphericLoss = Math.min(0.1 * (totalDistance / 1000), 5);
    } else {
        const humidityFactor = Math.max(0, humidity - 50) * 0.01 * (totalDistance / 1000);
        const tempFactor = (temperature - 15) * 0.02 * (totalDistance / 1000);
        const pressureFactor = (pressure - 1013) * 0.001 * (totalDistance / 1000);
        atmosphericLoss = humidityFactor + tempFactor + pressureFactor;
    }
    console.log('Atmospheric Loss:', atmosphericLoss.toFixed(2) + ' dB');

    const maxElevation = Math.max(...elevations.map(e => e.height || 0));
    const heightDiff = maxElevation - ((transmitterGroundElevation || 0) + txHeight + (receiverGroundElevation || 0) + rxHeight) / 2;
    let diffractionLoss = 0;
    const wavelength = 3e8 / frequency;
    if (heightDiff > 0 && !isNaN(wavelength) && wavelength > 0) {
        diffractionLoss = 6.9 + 20 * Math.log10(Math.sqrt((heightDiff * heightDiff) / (wavelength * wavelength)));
    }
    console.log('Diffraction Loss:', diffractionLoss.toFixed(2) + ' dB');

    const isClear = elevations.every(elevation => {
        const d1 = elevation.distance;
        const d2 = totalDistance - d1;
        const fresnelRadius = Math.sqrt((wavelength * d1 * d2) / totalDistance);
        const txGround = transmitterGroundElevation || 0;
        const rxGround = receiverGroundElevation || 0;
        const txClearance = txGround + txHeight + fresnelRadius;
        const rxClearance = rxGround + rxHeight + fresnelRadius;
        const clearance = Math.min(txClearance, rxClearance);
        console.log('Fresnel Check at', d1.toFixed(2) + ' m:', {
            elevation: elevation.height.toFixed(2) + ' m',
            fresnelRadius: fresnelRadius.toFixed(2) + ' m',
            clearance: clearance.toFixed(2) + ' m',
            isClear: elevation.height <= clearance
        });
        return elevation.height <= clearance;
    });
    console.log('Fresnel Zone Clear:', isClear);

    const effectiveTxPower = txPower + txAntennaGain;
    const totalLoss = fspl + terrainLoss + atmosphericLoss + diffractionLoss;
    const receivedPower = effectiveTxPower - totalLoss + rxAntennaGain;
    console.log('Effective Tx Power:', effectiveTxPower.toFixed(2) + ' dBm');
    console.log('Total Loss:', totalLoss.toFixed(2) + ' dB');
    console.log('Received Power:', receivedPower.toFixed(2) + ' dBm');

    let linkStatus = '';
    const fadeMargin = 15;
    if (receivedPower >= rxSensitivity + fadeMargin) {
        linkStatus = 'Link will work';
    } else if (receivedPower >= rxSensitivity) {
        linkStatus = 'Link may fail due to insufficient margin';
    } else {
        linkStatus = isClear ? 'Link will fail due to insufficient signal' : 'Link will fail due to obstruction';
    }

    const maxAllowableLoss = effectiveTxPower - rxSensitivity - fadeMargin;
    const txPowerWatts = dbmToWatts(txPower);
    const minEffectiveHeight = calculateMinEffectiveHeight(txHeight, frequency / 1e6);

    // Calculate minimum power required for the link to work
    const minReceivedPowerRequired = rxSensitivity + fadeMargin; // Target received power
    const minEffectiveTxPower = minReceivedPowerRequired + totalLoss - rxAntennaGain; // Required EIRP
    const minTxPowerDbm = minEffectiveTxPower - txAntennaGain; // Back-calculate Tx power in dBm
    const minTxPowerWatts = dbmToWatts(minTxPowerDbm); // Convert to watts

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
            <tr><td>Min Power Required</td><td>${minTxPowerWatts.toFixed(2)} W (${minTxPowerDbm.toFixed(1)} dBm)</td></tr>
            <tr><td>Tx Antenna Gain</td><td>${txAntennaGain.toFixed(1)} dBi</td></tr>
            <tr><td>Effective Radiated Power</td><td>${effectiveTxPower.toFixed(1)} dBm</td></tr>
            <tr><td>Received Power</td><td>${receivedPower.toFixed(1)} dBm</td></tr>
            <tr><td>Rx Antenna Gain</td><td>${rxAntennaGain.toFixed(1)} dBi</td></tr>
            <tr><td>Receiver Sensitivity</td><td>${rxSensitivity} dBm</td></tr>
            <tr><td>SNR</td><td>${receivedPower.toFixed(1)} dB</td></tr>
            <tr><td>Fade Margin</td><td>${fadeMargin} dB</td></tr>
            <tr><td>Max Allowable Loss</td><td>${maxAllowableLoss.toFixed(1)} dB</td></tr>
            <tr><td>Link Status</td><td>${linkStatus}</td></tr>
            <tr><td>Min Effective Height (HF Skywave, m)</td><td>${minEffectiveHeight.toFixed(1)}</td></tr>
            <tr><td>Atmospheric Conditions</td><td>Humidity: ${humidity}%, Temp: ${temperature}°C, Pressure: ${pressure} hPa</td></tr>
        </table>
    `;
    document.getElementById('result').innerHTML = linkBudget;

    return { linkStatus, elevations, totalDistance };
}

// Visualize Fresnel zone and add obstruction highlights on the map
function visualizeFresnelZone(totalDistance, elevations) {
    const frequency = getFrequency();
    const wavelength = 3e8 / frequency;
    const { txHeight, rxHeight } = getAntennaHeights();
    console.log('Visualizing Fresnel Zone:', {
        frequency: frequency / 1e6 + ' MHz',
        totalDistance: totalDistance + ' m',
        txHeight, rxHeight,
        wavelength: wavelength.toFixed(2) + ' m'
    });

    let svgContent = '';
    let isObstructed = false;

    const maxHeight = Math.max(...elevations.map(e => e.height), (transmitterGroundElevation || 0) + txHeight, (receiverGroundElevation || 0) + rxHeight) + 10;
    const heightScale = 150 / maxHeight;

    let terrainPath = '';
    elevations.forEach((elevation, i) => {
        const x = (elevation.distance / totalDistance) * 100;
        const y = 150 - (elevation.height * heightScale);
        if (i === 0) terrainPath += `M ${x}% ${y}`;
        else terrainPath += ` L ${x}% ${y}`;
    });

    const d1 = totalDistance / 2;
    const d2 = totalDistance - d1;
    const fresnelRadius = Math.sqrt((wavelength * d1 * d2) / totalDistance);
    const txGround = transmitterGroundElevation || 0;
    const rxGround = receiverGroundElevation || 0;
    const txClearance = txGround + txHeight + fresnelRadius;
    const rxClearance = rxGround + rxHeight + fresnelRadius;
    const clearance = Math.min(txClearance, rxClearance);
    const ellipseHeight = fresnelRadius * heightScale * 2;
    const ellipseY = 150 - (clearance * heightScale);
    svgContent += `
        <ellipse cx="50%" cy="${ellipseY}" rx="50%" ry="${ellipseHeight / 2}" stroke="black" stroke-width="1" fill="none" />
        <text class="fresnel-label" x="50%" y="${ellipseY - 10}" text-anchor="middle">n=1</text>
    `;

    svgContent += `
        <line x1="0%" y1="${150 - (txGround + txHeight) * heightScale}" x2="100%" y2="${150 - (rxGround + rxHeight) * heightScale}" stroke="blue" stroke-width="1" />
    `;

    svgContent += `<path d="${terrainPath}" fill="none" stroke="gray" stroke-width="2" />`;

    svgContent += `
        <text class="fresnel-label" x="25%" y="140" text-anchor="middle">d1=${Math.round(d1)}m</text>
        <text class="fresnel-label" x="75%" y="140" text-anchor="middle">d2=${Math.round(d2)}m</text>
        <text class="fresnel-label" x="50%" y="${ellipseY}" text-anchor="middle">r=${fresnelRadius.toFixed(1)}m</text>
        <text class="fresnel-label" x="0%" y="160" text-anchor="start">D=${Math.round(totalDistance)}m</text>
    `;

    // Clear previous obstruction markers/rectangles
    if (map.obstructionLayers) {
        map.obstructionLayers.forEach(layer => map.removeLayer(layer));
    }
    map.obstructionLayers = [];

    // Identify and highlight obstructions on the map with red boxes
    let obstructionSegments = [];
    for (let i = 0; i < elevations.length; i++) {
        const elevation = elevations[i];
        const d1 = elevation.distance;
        const d2 = totalDistance - d1;
        const fresnelRadiusP = Math.sqrt((wavelength * d1 * d2) / totalDistance);
        const txGround = transmitterGroundElevation || 0;
        const rxGround = receiverGroundElevation || 0;
        const txClearance = txGround + txHeight + fresnelRadiusP;
        const rxClearance = rxGround + rxHeight + fresnelRadiusP;
        const clearance = Math.min(txClearance, rxClearance);
        if (elevation.height > clearance) {
            isObstructed = true;
            console.log('Obstruction detected at:', {
                distance: d1.toFixed(2) + ' m',
                elevation: elevation.height.toFixed(2) + ' m',
                fresnelRadius: fresnelRadiusP.toFixed(2) + ' m',
                clearance: clearance.toFixed(2) + ' m',
                txGround: txGround.toFixed(2) + ' m',
                rxGround: rxGround.toFixed(2) + ' m'
            });
            // Create a red box around the obstruction on the map
            // Use a small buffer around the point (e.g., 0.0005 degrees lat/lon ~50m at this scale)
            const lat = elevation.lat;
            const lon = elevation.lon;
            const buffer = 0.0005; // Adjust for visibility (roughly 50m at this zoom level)
            const bounds = [
                [lat - buffer, lon - buffer], // Southwest corner
                [lat + buffer, lon + buffer]  // Northeast corner
            ];
            const obstructionBox = L.rectangle(bounds, {
                color: 'red',
                weight: 2,
                fillOpacity: 0.3,
                fillColor: 'red'
            }).addTo(map);
            map.obstructionLayers.push(obstructionBox);

            // Group consecutive obstructions into segments for a single box if close enough
            if (obstructionSegments.length === 0 || 
                Math.abs(elevation.distance - obstructionSegments[obstructionSegments.length - 1].distance) > 100) { // 100m gap to split segments
                obstructionSegments.push({ start: elevation, end: elevation });
            } else {
                obstructionSegments[obstructionSegments.length - 1].end = elevation;
            }
        }
    }

    // Optionally, create larger boxes for consecutive obstructions (if desired, but small boxes per point work well for precision)
    /*
    obstructionSegments.forEach(segment => {
        const startLat = segment.start.lat;
        const startLon = segment.start.lon;
        const endLat = segment.end.lat;
        const endLon = segment.end.lon;
        const bounds = [
            [Math.min(startLat, endLat) - buffer, Math.min(startLon, endLon) - buffer],
            [Math.max(startLat, endLat) + buffer, Math.max(startLon, endLon) + buffer]
        ];
        const largeBox = L.rectangle(bounds, {
            color: 'red',
            weight: 2,
            fillOpacity: 0.3,
            fillColor: 'red'
        }).addTo(map);
        map.obstructionLayers.push(largeBox);
    });
    */

    const svg = `<svg width="100%" height="200" style="position: relative;">${svgContent}</svg>`;
    const fresnelZoneDiv = document.getElementById('fresnel-zone');
    fresnelZoneDiv.innerHTML = svg;
    fresnelZoneDiv.className = isObstructed ? 'fresnel-zone obstructed' : 'fresnel-zone clear';
    fresnelZoneDiv.style.display = 'block';
}

// Suggest relay sites (Enhanced with 1, 2, 4, 11)
async function suggestRelaySites() {
    if (!transmitter || !receiver) {
        alert('Please place both transmitter and receiver first.');
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

    const { linkStatus, elevations, totalDistance } = await analyzePath();
    if (!elevations || elevations.length === 0) {
        alert('No elevation data available to suggest relay sites.');
        return;
    }
    if (linkStatus === 'Link will work') {
        alert('Direct link is workable. No relay sites needed.');
        return;
    }

    // Clear previous relay markers
    relayMarkers.forEach(marker => map.removeLayer(marker));
    relayMarkers = [];

    const frequency = getFrequency();
    const wavelength = 3e8 / frequency;
    const { txHeight, rxHeight } = getAntennaHeights();
    let relaySites = [];
    let currentTx = { latLng: transmitter, elevation: elevations[0].height };
    let remainingDistance = totalDistance;
    const minSpacing = totalDistance * 0.1; // Enhancement 2: Minimum 10% of total distance between relays

    console.log('Starting relay site suggestion... Total Distance:', totalDistance);

    while (remainingDistance > wavelength) {
        let bestRelay = null;
        let bestScore = -Infinity;
        let maxObstruction = { height: -Infinity, distance: 0 };

        // Find obstructions for detailed feedback (Enhancement 11)
        elevations.forEach(elevation => {
            const d1 = elevation.distance;
            const d2 = totalDistance - d1;
            const fresnelRadius = Math.sqrt((wavelength * d1 * d2) / totalDistance);
            const txGround = transmitterGroundElevation || 0;
            const rxGround = receiverGroundElevation || 0;
            const txClearance = txGround + txHeight + fresnelRadius;
            const rxClearance = rxGround + rxHeight + fresnelRadius;
            const clearance = Math.min(txClearance, rxClearance);
            if (elevation.height > clearance && elevation.height > maxObstruction.height) {
                maxObstruction = { height: elevation.height, distance: d1 };
            }
        });

        // Find best relay with scoring (Enhancement 1)
        for (let i = 1; i < elevations.length; i++) {
            const elevation = elevations[i];
            const relayLatLng = L.latLng(elevation.lat, elevation.lon);
            const segmentDistance = currentTx.latLng.distanceTo(relayLatLng);
            if (segmentDistance > remainingDistance || segmentDistance < minSpacing) continue; // Enhancement 2

            const segmentElevations = elevations.slice(elevations.findIndex(e => Math.abs(e.lat - currentTx.latLng.lat) < 0.0001 && Math.abs(e.lon - currentTx.latLng.lng) < 0.0001), i + 1);
            const { linkStatus: segmentStatus } = calculateRF(segmentDistance, segmentElevations);

            if (segmentStatus === 'Link will work') {
                const distanceFactor = segmentDistance / totalDistance; // Normalize distance
                const score = elevation.height * (1 + distanceFactor); // Enhancement 1: Weight elevation and distance
                if (score > bestScore) {
                    bestScore = score;
                    bestRelay = { latLng: relayLatLng, elevation: elevation.height };
                }
            }
        }

        if (!bestRelay) {
            const obstructionMsg = maxObstruction.height > -Infinity ? 
                `Major obstruction at ${Math.round(maxObstruction.distance)}m (Height: ${maxObstruction.height}m)` : 
                'No clear path found within signal range.';
            console.log('No viable relay site found. ', obstructionMsg);
            alert(`No viable relay sites found. ${obstructionMsg}`); // Enhancement 11
            break;
        }

        relaySites.push(bestRelay);
        console.log(`Added relay at Lat: ${bestRelay.latLng.lat}, Lon: ${bestRelay.latLng.lng}, Elevation: ${bestRelay.elevation}m, Distance Covered: ${currentTx.latLng.distanceTo(bestRelay.latLng)}m`);
        currentTx = bestRelay;
        remainingDistance = receiver.distanceTo(currentTx.latLng);

        const finalElevations = elevations.slice(elevations.findIndex(e => Math.abs(e.lat - currentTx.latLng.lat) < 0.0001 && Math.abs(e.lon - currentTx.latLng.lng) < 0.0001));
        const finalDistance = currentTx.latLng.distanceTo(receiver);
        const { linkStatus: finalStatus } = calculateRF(finalDistance, finalElevations);
        console.log(`Final segment check: Distance: ${finalDistance}m, Status: ${finalStatus}, Remaining: ${remainingDistance}m`);

        if (finalStatus === 'Link will work') {
            console.log('Final segment is workable. Relay suggestion complete.');
            break;
        }

        if (relaySites.length > numPoints / 2) {
            console.log('Too many relays suggested.');
            alert(`Unable to find a complete relay path. Max relays reached. Last obstruction at ${Math.round(maxObstruction.distance)}m (Height: ${maxObstruction.height}m)`);
            break;
        }
    }

    if (relaySites.length === 0) {
        const obstructionMsg = maxObstruction.height > -Infinity ? 
            `Major obstruction at ${Math.round(maxObstruction.distance)}m (Height: ${maxObstruction.height}m)` : 
            'No clear path found within signal range.';
        alert(`No relay sites could be suggested. ${obstructionMsg}`);
        return;
    }

    // Plot relay sites with drag capability (Enhancement 4)
    relaySites.forEach((site, index) => {
        const marker = L.marker(site.latLng, {
            icon: L.icon({
                iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PGNpcmNsZSBjeD0iNSIgY3y9IjUiIHI9IjUiIGZpbGw9InB1cnBsZSIvPjwvc3ZnPg==',
                iconSize: [10, 10],
                iconAnchor: [5, 5],
                popupAnchor: [0, -5]
            }),
            draggable: true
        }).addTo(map).bindPopup(`Relay Site ${index + 1}<br>Elevation: ${site.elevation}m<br>Lat: ${site.latLng.lat.toFixed(4)}, Lon: ${site.latLng.lng.toFixed(4)}`);
        marker.on('dragend', (e) => {
            const newLatLng = e.target.getLatLng();
            console.log(`Relay ${index + 1} moved to Lat: ${newLatLng.lat}, Lon: ${newLatLng.lng}`);
            relaySites[index].latLng = newLatLng;
            relaySites[index].elevation = parseFloat(getSingleElevation(newLatLng)) || site.elevation;
            e.target.setPopupContent(`Relay Site ${index + 1}<br>Elevation: ${relaySites[index].elevation}m<br>Lat: ${newLatLng.lat.toFixed(4)}, Lon: ${newLatLng.lng.toFixed(4)}`);
            updateRelayPath(relaySites);
            analyzePath(); // Re-draw chart with updated relay positions
        });
        relayMarkers.push(marker);
    });

    // Update polyline to show relay segments
    updateRelayPath(relaySites);

    alert(`Suggested ${relaySites.length} relay site(s) to make the link workable. Drag relays to adjust.`);
}

// Helper function to update relay path (Enhancement 4)
function updateRelayPath(relaySites) {
    if (polylineLayer) map.removeLayer(polylineLayer);
    const path = [transmitter, ...relaySites.map(s => s.latLng), receiver];
    polylineLayer = L.polyline(path, { color: 'purple', dashArray: '5, 10' }).addTo(map);
}

// Show loading indicator
function showLoading(show) {
    console.log(`Showing loading: ${show ? 'true' : 'false'}`);
    document.getElementById('loading').style.display = show ? 'block' : 'none';
    if (!show) {
        const resultDiv = document.getElementById('result');
        if (resultDiv.innerText === 'Loading...') {
            resultDiv.innerText = 'Analysis failed or no data available.';
        }
    }
}

// Update polyline
function updatePolyline(color) {
    if (polylineLayer) map.removeLayer(polylineLayer);
    if (transmitter && receiver) {
        polylineLayer = L.polyline([transmitter, receiver], {
            color: color || 'gray',
            className: `polyline-${color}`
        }).addTo(map);

        const distance = transmitter.distanceTo(receiver) / 1000;
        const midPoint = L.latLng(
            (transmitter.lat + receiver.lat) / 2,
            (transmitter.lng + receiver.lng) / 2
        );
        L.marker(midPoint, {
            icon: L.divIcon({
                className: 'distance-label',
                html: `${distance.toFixed(2)} km`,
                iconSize: [100, 20]
            })
        }).addTo(map);
    }
}

// Reset link
function resetLink() {
    transmitter = null;
    receiver = null;
    transmitterGroundElevation = 0; // Reset Tx ground elevation
    receiverGroundElevation = 0;    // Reset Rx ground elevation
    if (txMarker) map.removeLayer(txMarker);
    if (rxMarker) map.removeLayer(rxMarker);
    if (polylineLayer) map.removeLayer(polylineLayer);
    relayMarkers.forEach(marker => map.removeLayer(marker));
    relayMarkers = [];
    txMarker = null;
    rxMarker = null;
    polylineLayer = null;
    if (elevationChart) elevationChart.destroy();
    document.getElementById('frequency').value = '30';
    document.getElementById('txHeight').value = '5';
    document.getElementById('rxHeight').value = '5';
    document.getElementById('txPower').value = '1';
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
    document.getElementById('txLat').value = '';
    document.getElementById('txLng').value = '';
    document.getElementById('rxLat').value = '';
    document.getElementById('rxLng').value = '';
    alert('Link reset successfully!');
}

// Save path
function savePath() {
    if (transmitter && receiver) {
        const pathData = {
            transmitter: { lat: transmitter.lat, lng: transmitter.lng, bng: document.getElementById('txBNG').value || null },
            receiver: { lat: receiver.lat, lng: receiver.lng, bng: document.getElementById('rxBNG').value || null },
            frequency: document.getElementById('frequency').value || '30',
            txHeight: document.getElementById('txHeight').value || '5',
            rxHeight: document.getElementById('rxHeight').value || '5',
            txPower: document.getElementById('txPower').value || '1',
            rxSensitivity: document.getElementById('rxSensitivity').value || '90',
            txAntennaGain: document.getElementById('txAntennaGain').value || '0',
            rxAntennaGain: document.getElementById('rxAntennaGain').value || '0',
            terrainType: document.getElementById('terrainType').value || 'open',
            pathGranularity: document.getElementById('pathGranularity').value || 'medium',
            hfFrequency: document.getElementById('hfFrequency').value || '7',
            hfAntennaHeight: document.getElementById('hfAntennaHeight').value || '5',
            hfTime: document.getElementById('hfTime').value || 'day',
            hfSolarActivity: document.getElementById('hfSolarActivity').value || 'medium',
            atmosphericData: atmosphericData,
            transmitterGroundElevation: transmitterGroundElevation,
            receiverGroundElevation: receiverGroundElevation
        };
        localStorage.setItem('rfPath', JSON.stringify(pathData));
        alert('Path saved successfully!');
    } else {
        alert('Select both points before saving.');
    }
}

// Load path
function loadPath() {
    const pathData = JSON.parse(localStorage.getItem('rfPath') || '{}');
    if (pathData.transmitter && pathData.receiver) {
        if (txMarker) map.removeLayer(txMarker);
        if (rxMarker) map.removeLayer(rxMarker);
        if (polylineLayer) map.removeLayer(polylineLayer);
        relayMarkers.forEach(marker => map.removeLayer(marker));
        relayMarkers = [];
        if (elevationChart) elevationChart.destroy();

        transmitter = L.latLng(pathData.transmitter.lat, pathData.transmitter.lng);
        receiver = L.latLng(pathData.receiver.lat, pathData.receiver.lng);
        document.getElementById('frequency').value = pathData.frequency || '30';
        document.getElementById('txHeight').value = pathData.txHeight || '5';
        document.getElementById('rxHeight').value = pathData.rxHeight || '5';
        document.getElementById('txPower').value = pathData.txPower || '1';
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
        transmitterGroundElevation = pathData.transmitterGroundElevation || 0;
        receiverGroundElevation = pathData.receiverGroundElevation || 0;
        lastAtmosphericUpdate = 0;
        updateAtmosphericStatus();

        txMarker = L.marker(transmitter, { 
            icon: L.icon({
                iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PHJlY3QgeD0iMCIgeT0iMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSJibHVlIi8+PC9zdmc+',
                iconSize: [10, 10],
                iconAnchor: [5, 5],
                popupAnchor: [0, -5]
            }),
            draggable: true 
        }).addTo(map).bindPopup('Transmitter').openPopup();
        rxMarker = L.marker(receiver, { 
            icon: L.icon({
                iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PHJlY3QgeD0iMCIgeT0iMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSJyZWQiLz4+PC9zdmc+',
                iconSize: [10, 10],
                iconAnchor: [5, 5],
                popupAnchor: [0, -5]
            }),
            draggable: true 
        }).addTo(map).bindPopup('Receiver').openPopup();
        txMarker.on('dragend', onMarkerDrag);
        rxMarker.on('dragend', onMarkerDrag);
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

// Export data
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
        txPower: document.getElementById('txPower').value || '1',
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
// Import data
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
                    if (txMarker) map.removeLayer(txMarker);
                    if (rxMarker) map.removeLayer(rxMarker);
                    if (polylineLayer) map.removeLayer(polylineLayer);
                    relayMarkers.forEach(marker => map.removeLayer(marker));
                    relayMarkers = [];
                    if (elevationChart) elevationChart.destroy();

                    transmitter = L.latLng(pathData.transmitter.lat, pathData.transmitter.lng);
                    receiver = L.latLng(pathData.receiver.lat, pathData.receiver.lng);
                    document.getElementById('frequency').value = pathData.frequency || '30';
                    document.getElementById('txHeight').value = pathData.txHeight || '5';
                    document.getElementById('rxHeight').value = pathData.rxHeight || '5';
                    document.getElementById('txPower').value = pathData.txPower || '1';
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
                            iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PGNpcmNsZSBjeD0iNSIgY3k9IjUiIHI9IjUiIGZpbGw9ImJsdWUiLz48L3N2Zz4=',
                            iconSize: [10, 10],
                            iconAnchor: [5, 5],
                            popupAnchor: [0, -5]
                        }),
                        draggable: true 
                    }).addTo(map).bindPopup('Transmitter').openPopup();
                    rxMarker = L.marker(receiver, { 
                        icon: L.icon({
                            iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PGNpcmNsZSBjeD0iNSIgY3k9IjUiIHI9IjUiIGZpbGw9InJlZCIvPjwvc3ZnPg==',
                            iconSize: [10, 10],
                            iconAnchor: [5, 5],
                            popupAnchor: [0, -5]
                        }),
                        draggable: true 
                    }).addTo(map).bindPopup('Receiver').openPopup();
                    txMarker.on('dragend', onMarkerDrag);
                    rxMarker.on('dragend', onMarkerDrag);
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
function setupTooltips() {
    document.querySelectorAll('.tooltip').forEach(tooltip => {
        tooltip.addEventListener('mouseover', () => {
            const tooltipText = tooltip.getAttribute('data-tooltip');
            tooltip.setAttribute('title', tooltipText);
        });
        tooltip.addEventListener('mouseout', () => {
            tooltip.removeAttribute('title');
        });
    });
}

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
        <p><strong>Notes:</strong> Results are approximate and depend on ionospheric conditions.</p>
    `;
    document.getElementById('hf-result').innerHTML = hfResult;
}

// Calculate minimum effective height for HF skywave
function calculateMinEffectiveHeight(antennaHeight, frequencyMHz) {
    const wavelengthMeters = 300 / frequencyMHz;
    return Math.max(antennaHeight, 0.1 * wavelengthMeters);
}
// Calculate HF working frequencies
function calculateHFWorkingFrequencies(frequencyMHz, time, solarActivity) {
    let mufBase = 0;
    switch (solarActivity) {
        case 'low': mufBase = 15; break;
        case 'medium': mufBase = 25; break;
        case 'high': mufBase = 35; break;
        default: mufBase = 25;
    }
    if (time === 'night') mufBase *= 0.7;
    else mufBase *= 1.0;
    const muf = Math.min(mufBase, 30);
    const luf = Math.max(3, muf * 0.3);
    const fot = muf * 0.85;
    return { luf, fot, muf };
}
// Search location
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
        alert(`Error finding location: ${error.message}.`);
        showLoading(false);
    }
}

// Update atmospheric conditions
async function updateAtmosphericConditions() {
    const now = Date.now();
    // Only fetch new data if 30 minutes have passed, regardless of points
    if (now - lastAtmosphericUpdate < 1800000) {
        updateAtmosphericStatus();
        return;
    }

    // Use defaults if no points, or proceed with fetch if API key is set
    if (!transmitter || !receiver) {
        atmosphericData = { humidity: 50, temperature: 15, pressure: 1013 }; // Silent defaults
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
        analyzePath(); // Still re-analyze path with new data
    } catch (error) {
        console.error('Error fetching atmospheric conditions:', error);
        atmosphericData = { humidity: 50, temperature: 15, pressure: 1013 }; // Silent fallback
        lastAtmosphericUpdate = 0;
        updateAtmosphericStatus();
    } finally {
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

    // Real-time validation for inputs (only IDs present in index.html)
    ['frequency', 'txHeight', 'rxHeight', 'txPower', 'rxSensitivity', 'txAntennaGain', 'rxAntennaGain', 'terrainType'].forEach(id => {
        const input = document.getElementById(id);
        if (input) { // Safety check in case an ID is missing
            input.addEventListener('input', () => {
                const value = parseFloat(input.value) || 0;
                if (id === 'frequency' && !((value >= 30 && value <= 87.975) || (value >= 225 && value <= 450))) {
                    input.classList.add('invalid');
                    input.title = 'Frequency must be between 30-87.975 MHz or 225-450 MHz';
                } else if ((id === 'txHeight' || id === 'rxHeight') && value < 0) {
                    input.classList.add('invalid');
                    input.title = 'Height must be positive';
                } else if (id === 'txPower' && (isNaN(value) || value <= 0)) {
                    input.classList.add('invalid');
                    input.title = 'Transmitter power must be a positive value in watts';
                } else if (id === 'rxSensitivity' && isNaN(value)) {
                    input.classList.add('invalid');
                    input.title = 'Receiver sensitivity must be a valid number in dBm';
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
        } else {
            console.warn(`Input element with ID '${id}' not found in DOM`);
        }
    });

    // Add event listeners for buttons and inputs
    document.getElementById('analyzeButton').addEventListener('click', analyzePath);
    document.getElementById('resetButton').addEventListener('click', resetLink);
    document.getElementById('saveButton').addEventListener('click', savePath);
    document.getElementById('loadButton').addEventListener('click', loadPath);
    document.getElementById('exportButton').addEventListener('click', exportData);
    document.getElementById('importButton').addEventListener('click', importData);
    document.getElementById('searchButton').addEventListener('click', () => {
        console.log('Search button clicked'); // Debug log
        searchLocation();
    });

    // Handle map layer change
    const mapLayerSelect = document.getElementById('map-layer');
    if (mapLayerSelect) {
        mapLayerSelect.addEventListener('change', (e) => {
            console.log('Map layer changed to:', e.target.value); // Debug log
            changeMapLayer(e.target.value);
        });
    } else {
        console.error('Map layer select element not found');
    }

    // Handle placement mode change (radio buttons) with safety
    const placementRadios = document.querySelectorAll('input[name="placementMode"]');
    if (placementRadios.length > 0) {
        placementRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                updatePlacementMode(e.target.value);
                console.log(`Placement mode updated to: ${e.target.value}`); // Debug log
            });
        });
        // Ensure initial mode is set to 'click' and listener is attached
        if (!placementMode || placementMode !== 'click') {
            placementMode = 'click';
            document.querySelector('input[value="click"]').checked = true;
        }
        updatePlacementMode(placementMode); // Force update to attach click listener
    } else {
        console.error('Placement mode radio buttons not found');
    }

    // Re-attach click listener for map in click mode (safety)
    if (map && placementMode === 'click') {
        map.off('click');
        map.on('click', async (e) => {
            console.log('Map clicked in DOMContentLoaded at:', e.latlng);
            const elevation = await getSingleElevation(e.latlng);
            console.log(`Elevation at click: ${elevation}m`);
            if (!transmitter) {
                transmitter = e.latlng;
                txMarker = L.marker(transmitter, { 
                    icon: L.icon({
                        iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PGNpcmNsZSBjeD0iNSIgY3y9IjUiIHI9IjUiIGZpbGw9ImJsdWUiLz48L3N2Zz4=',
                        iconSize: [10, 10],
                        iconAnchor: [5, 5],
                        popupAnchor: [0, -5]
                    }),
                    draggable: true 
                }).addTo(map).bindPopup(`Transmitter<br>Elevation: ${elevation}m`).openPopup();
                txMarker.on('dragend', onMarkerDrag);
                console.log(`Transmitter placed at: Lat ${transmitter.lat}, Lon ${transmitter.lng}`);
                updateAtmosphericConditions();
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
                }).addTo(map).bindPopup(`Receiver<br>Elevation: ${elevation}m`).openPopup();
                rxMarker.on('dragend', onMarkerDrag);
                console.log(`Receiver placed at: Lat ${receiver.lat}, Lon ${receiver.lng}`);
                if (polylineLayer) map.removeLayer(polylineLayer);
                updatePolyline();
                analyzePath();
            } else {
                map.removeLayer(txMarker);
                map.removeLayer(rxMarker);
                if (polylineLayer) map.removeLayer(polylineLayer);
                transmitter = e.latlng;
                receiver = null;
                txMarker = L.marker(transmitter, { 
                    icon: L.icon({
                        iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaHVpZ2h0PSIxMCI+PGNpcmNsZSBjeD0iNSIgY3y9IjUiIHI9IjUiIGZpbGw9ImJsdWUiLz48L3N2Zz4=',
                        iconSize: [10, 10],
                        iconAnchor: [5, 5],
                        popupAnchor: [0, -5]
                    }),
                    draggable: true 
                }).addTo(map).bindPopup(`Transmitter<br>Elevation: ${elevation}m`).openPopup();
                txMarker.on('dragend', onMarkerDrag);
                console.log(`Reset and placed Transmitter at: Lat ${transmitter.lat}, Lon ${transmitter.lng}`);
                rxMarker = null;
                updatePolyline();
                updateAtmosphericConditions();
            }
        });
    }

    // Initialize atmospheric conditions display
    updateAtmosphericStatus();

    // Load saved path on startup if available
    if (localStorage.getItem('rfPath')) {
        loadPath();
    }

    // Debug: Test map layer switching manually
    console.log('Manually testing map layer switch to topo');
    changeMapLayer('topo');
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

// Standalone debug listener to confirm map-layer events
document.addEventListener('DOMContentLoaded', () => {
    const testLayerSelect = document.getElementById('map-layer');
    if (testLayerSelect) {
        testLayerSelect.addEventListener('change', () => {
            console.log('Test: Map layer select changed');
        });
    } else {
        console.error('Test: Map layer select element not found');
    }
});
