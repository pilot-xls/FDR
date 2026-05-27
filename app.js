
/* Flight Data Recorder PWA v4 with flight time, next sector and sector export. */

/* Defines default settings for the aircraft and detection algorithm. */
const DEFAULT_SETTINGS = {
  taxiMaxKt: 20,
  takeoffSpeedKt: 35,
  initialClimbSpeedKt: 90,
  climbVsFpm: 400,
  descentVsFpm: 300,
  stableSeconds: 60,
  cruiseVsBandFpm: 250,
  approachTriggerKt: 130,
  landingSpeedKt: 85,
  autoStopKt: 3,
  autoStopSeconds: 30,
  minGpsIntervalSeconds: 2,
  fuelUntilTocLbh: 720,
  fuelCruiseLbh: 600,
  fuelDescentApproachLbh: 580
};

/* Stores the localStorage key for settings. */
const SETTINGS_KEY = "flightDataRecorderSettings.v4";

/* Stores the localStorage key for all sectors and the active sector. */
const STATE_KEY = "flightDataRecorderState.v4";

/* Stores the geolocation watch identifier. */
let watchId = null;

/* Stores the optional screen wake lock. */
let wakeLock = null;

/* Stores the UI timer identifier. */
let uiTimerId = null;

/* Prevents repeated auto-stop prompts. */
let autoStopPromptOpen = false;

/* Stores the timestamp from which the aircraft appears stopped. */
let stoppedSinceMs = null;

/* Loads saved settings or uses defaults. */
let settings = loadSettings();

/* Creates the main application state. */
let state = loadState() || createInitialState();

/* Stores UI element references. */
const ui = {
  recordingBadge: document.getElementById("recordingBadge"),
  toggleRecordBtn: document.getElementById("toggleRecordBtn"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),
  exportJsonBtn: document.getElementById("exportJsonBtn"),
  sectorBadge: document.getElementById("sectorBadge"),
  sectorName: document.getElementById("sectorName"),
  sectorRoute: document.getElementById("sectorRoute"),
  flightTime: document.getElementById("flightTime"),
  blockTime: document.getElementById("blockTime"),
  gpsStatus: document.getElementById("gpsStatus"),
  gpsDetails: document.getElementById("gpsDetails"),
  flightStatus: document.getElementById("flightStatus"),
  flightDetails: document.getElementById("flightDetails"),
  speedKt: document.getElementById("speedKt"),
  speedMs: document.getElementById("speedMs"),
  altitudeFt: document.getElementById("altitudeFt"),
  verticalSpeed: document.getElementById("verticalSpeed"),
  logTableBody: document.getElementById("logTableBody"),
  sectorsTableBody: document.getElementById("sectorsTableBody"),
  savedSectorCount: document.getElementById("savedSectorCount"),
  pointCount: document.getElementById("pointCount"),
  lastPoints: document.getElementById("lastPoints"),
  tabFlight: document.getElementById("tabFlight"),
  tabSettings: document.getElementById("tabSettings"),
  tabSwitchBtn: document.getElementById("tabSwitchBtn"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  defaultSettingsBtn: document.getElementById("defaultSettingsBtn")
};

/* Stores settings input references. */
const settingInputs = {
  taxiMaxKt: document.getElementById("taxiMaxKt"),
  takeoffSpeedKt: document.getElementById("takeoffSpeedKt"),
  initialClimbSpeedKt: document.getElementById("initialClimbSpeedKt"),
  climbVsFpm: document.getElementById("climbVsFpm"),
  descentVsFpm: document.getElementById("descentVsFpm"),
  stableSeconds: document.getElementById("stableSeconds"),
  cruiseVsBandFpm: document.getElementById("cruiseVsBandFpm"),
  approachTriggerKt: document.getElementById("approachTriggerKt"),
  landingSpeedKt: document.getElementById("landingSpeedKt"),
  autoStopKt: document.getElementById("autoStopKt"),
  autoStopSeconds: document.getElementById("autoStopSeconds"),
  minGpsIntervalSeconds: document.getElementById("minGpsIntervalSeconds"),
  fuelUntilTocLbh: document.getElementById("fuelUntilTocLbh"),
  fuelCruiseLbh: document.getElementById("fuelCruiseLbh"),
  fuelDescentApproachLbh: document.getElementById("fuelDescentApproachLbh")
};

/* Initializes the application. */
init();

/* Creates an empty application state. */
function createInitialState() {
  /* Returns a complete initial state. */
  return {
    isRecording: false,
    activeSector: createSector(1),
    savedSectors: [],
    currentPhase: "—",
    lastPhaseChangeMs: 0,
    hadTakeoff: false,
    hadToc: false,
    hadTod: false,
    hadLanding: false,
    lastGroundReferenceFt: null
  };
}

/* Creates a new sector object. */
function createSector(number) {
  /* Returns a sector with empty logs and points. */
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${number}`,
    number,
    name: `Sector ${number}`,
    departure: null,
    destination: null,
    blockOffAt: null,
    blockOnAt: null,
    takeoffAt: null,
    landingAt: null,
    points: [],
    logs: [],
    totals: { blockSeconds: 0, flightSeconds: 0, fuelLb: 0 }
  };
}

/* Wires events and renders the first view. */
function init() {
  /* Starts recording when the start button is pressed. */
  ui.toggleRecordBtn.addEventListener("click", toggleRecording);

  /* Exports CSV when pressed. */
  ui.exportCsvBtn.addEventListener("click", exportCsv);

  /* Exports JSON when pressed. */
  ui.exportJsonBtn.addEventListener("click", exportJson);

  /* Alternates between flight and settings tabs. */
  ui.tabSwitchBtn.addEventListener("click", toggleTab);

  /* Saves settings from the form. */
  ui.saveSettingsBtn.addEventListener("click", saveSettingsFromForm);

  /* Restores default settings. */
  ui.defaultSettingsBtn.addEventListener("click", restoreDefaultSettings);

  /* Writes current settings into the form. */
  fillSettingsForm();

  /* Ensures a previously open recording is not treated as still recording after reload. */
  state.isRecording = false;

  /* Renders the UI. */
  render();

  /* Starts the live clock. */
  startUiTimer();

  /* Registers the service worker for offline use. */
  registerServiceWorker();
}

/* Toggles recording from the fixed bottom button. */
async function toggleRecording() {
  if (state.isRecording) {
    await finalizeCurrentSector(false);
    return;
  }

  const hasData = state.savedSectors.length > 0 || state.activeSector.points.length > 0 || state.activeSector.logs.length > 0 || state.activeSector.blockOffAt;
  if (hasData) {
    const confirmed = confirm("Start vai apagar o setor atual e os setores guardados. Continuar?");
    if (!confirmed) return;
  }

  await resetAll(true);
  await startRecording();
}

/* Starts GPS recording and creates blocks off/taxi. */
async function startRecording() {
  /* Checks that geolocation exists in the current browser. */
  if (!("geolocation" in navigator)) {
    setGpsStatus("Error", "This browser does not support geolocation.");
    return;
  }

  /* Creates a fresh sector if the previous active sector is already closed. */
  if (state.activeSector.blockOnAt) {
    state.activeSector = createSector(state.savedSectors.length + 1);
    resetDetectionFlags();
  }

  /* Marks the app as recording. */
  state.isRecording = true;

  /* Creates blocks off and taxi when the sector starts. */
  if (!state.activeSector.blockOffAt) {
    const nowIso = new Date().toISOString();
    state.activeSector.blockOffAt = nowIso;
    setPhase("blocks off", nowIso, Date.now());
    setPhase("taxi", nowIso, Date.now());
  }

  /* Requests screen wake lock when supported. */
  await requestWakeLock();

  /* Starts continuous GPS tracking. */
  watchId = navigator.geolocation.watchPosition(handlePosition, handleGeoError, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 15000
  });

  /* Updates the GPS card while waiting for the first point. */
  setGpsStatus("Searching", "Waiting for high accuracy GPS.");

  /* Saves and renders the state. */
  saveState();
  render();
}

/* Stops the GPS watch without closing the sector. */
async function stopGpsOnly() {
  /* Clears the active geolocation watch. */
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  /* Marks recording as stopped. */
  state.isRecording = false;

  /* Releases screen wake lock. */
  await releaseWakeLock();
}

/* Finalizes the current sector as blocks on. */
async function finalizeCurrentSector(startNextAfterSave) {
  /* Does nothing if the sector is already closed. */
  if (state.activeSector.blockOnAt) return;

  /* Stops GPS updates. */
  await stopGpsOnly();

  /* Uses the current time as blocks on. */
  const nowIso = new Date().toISOString();

  /* Closes the current phase. */
  closeCurrentLog(nowIso);

  /* Creates and closes blocks on. */
  setPhase("blocks on", nowIso, Date.now());
  closeCurrentLog(nowIso);

  /* Stores block-on time. */
  state.activeSector.blockOnAt = nowIso;

  /* Recalculates totals. */
  updateSectorTotals(state.activeSector);

  /* Attempts to identify departure and destination. */
  await resolveSectorAirports(state.activeSector);

  /* Requests a manual name if automatic naming failed. */
  await ensureSectorName(state.activeSector);

  /* Saves a copy of the closed sector. */
  state.savedSectors.push(clone(state.activeSector));

  /* Saves the full state. */
  saveState();

  /* Renders the closed sector summary. */
  render();

  /* Starts a new sector if requested. */
  if (startNextAfterSave) {
    await startNextSector();
  }
}

/* Starts a new sector immediately after saving the previous sector. */
async function startNextSector() {
  /* Calculates the next sector number. */
  const nextNumber = state.savedSectors.length + 1;

  /* Creates the new active sector. */
  state.activeSector = createSector(nextNumber);

  /* Resets detection flags. */
  resetDetectionFlags();

  /* Saves state before starting GPS. */
  saveState();

  /* Starts recording the new sector. */
  await startRecording();
}

/* Resets algorithm flags for a fresh sector. */
function resetDetectionFlags() {
  /* Clears the current flight phase. */
  state.currentPhase = "—";

  /* Clears the last phase timestamp. */
  state.lastPhaseChangeMs = 0;

  /* Clears phase-detection flags. */
  state.hadTakeoff = false;
  state.hadToc = false;
  state.hadTod = false;
  state.hadLanding = false;

  /* Clears the rough ground reference. */
  state.lastGroundReferenceFt = null;

  /* Clears auto-stop state. */
  stoppedSinceMs = null;
  autoStopPromptOpen = false;
}

/* Handles each GPS position received from the browser. */
async function handlePosition(position) {
  /* Converts the browser position to the internal point format. */
  const point = normalizePosition(position);

  /* Skips points that arrive too close together. */
  if (shouldSkipPoint(point)) return;

  /* Adds the point to the active sector. */
  state.activeSector.points.push(point);

  /* Detects the current phase from the new point. */
  detectPhase(point);

  /* Updates total times and fuel. */
  updateSectorTotals(state.activeSector);

  /* Saves data locally. */
  saveState();

  /* Updates the UI. */
  render();

  /* Checks whether final taxi has stopped and asks next-sector question. */
  await maybeAskAutoStop(point);
}

/* Handles geolocation errors. */
function handleGeoError(error) {
  /* Maps geolocation errors to readable messages. */
  const messages = {
    1: "Location permission denied.",
    2: "Position unavailable.",
    3: "Timeout while getting location."
  };

  /* Shows the error message. */
  setGpsStatus("Error", messages[error.code] || error.message || "Unknown GPS error.");

  /* Re-renders the UI. */
  render();
}

/* Converts a GeolocationPosition into an app point. */
function normalizePosition(position) {
  /* Shortens access to browser coordinates. */
  const c = position.coords;

  /* Converts altitude to feet. */
  const altitudeFt = metersToFeet(c.altitude);

  /* Converts speed to knots. */
  const speedKt = msToKnots(c.speed);

  /* Calculates vertical speed from the previous point. */
  const verticalSpeedFpm = calculateVerticalSpeedFpm(position.timestamp, altitudeFt);

  /* Returns the normalized point. */
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(position.timestamp),
    timestampMs: position.timestamp,
    timeIso: new Date(position.timestamp).toISOString(),
    latitude: c.latitude,
    longitude: c.longitude,
    altitudeM: c.altitude,
    altitudeFt,
    accuracyM: c.accuracy,
    altitudeAccuracyM: c.altitudeAccuracy,
    speedMs: c.speed,
    speedKt,
    headingDeg: c.heading,
    verticalSpeedFpm
  };
}

/* Decides whether the point should be skipped. */
function shouldSkipPoint(point) {
  /* Gets the previous point. */
  const previous = state.activeSector.points[state.activeSector.points.length - 1];

  /* Accepts the first point. */
  if (!previous) return false;

  /* Calculates point interval in seconds. */
  const seconds = (point.timestampMs - previous.timestampMs) / 1000;

  /* Skips if the interval is below the configured minimum. */
  return seconds < settings.minGpsIntervalSeconds;
}

/* Calculates vertical speed using altitude difference. */
function calculateVerticalSpeedFpm(timestampMs, altitudeFt) {
  /* Gets the previous point. */
  const previous = state.activeSector.points[state.activeSector.points.length - 1];

  /* Fails safely if altitude is missing. */
  if (!previous || altitudeFt === null || previous.altitudeFt === null) return null;

  /* Calculates time difference in minutes. */
  const minutes = (timestampMs - previous.timestampMs) / 60000;

  /* Avoids invalid division. */
  if (minutes <= 0) return null;

  /* Returns feet per minute. */
  return (altitudeFt - previous.altitudeFt) / minutes;
}

/* Detects flight phase transitions. */
function detectPhase(point) {
  /* Reads current phase. */
  const current = state.currentPhase;

  /* Reads speed and vertical speed with safe fallbacks. */
  const speedKt = point.speedKt ?? 0;
  const vsFpm = point.verticalSpeedFpm ?? 0;

  /* Updates rough ground altitude reference. */
  updateGroundReference(point);

  /* Starts with the existing phase. */
  let next = current === "—" ? "taxi" : current;

  /* Detects takeoff when speed rises from taxi. */
  if (next === "taxi" && !state.hadTakeoff && speedKt >= settings.takeoffSpeedKt) {
    next = "takeoff";
  }

  /* Detects initial climb as the airborne point and starts flight time. */
  if (next === "takeoff" && speedKt >= settings.initialClimbSpeedKt && (vsFpm >= settings.climbVsFpm || point.altitudeFt === null)) {
    next = "initial climb";
    state.hadTakeoff = true;
    state.activeSector.takeoffAt = state.activeSector.takeoffAt || point.timeIso;
  }

  /* Detects sustained climb. */
  if (next === "initial climb" && isTrendSustained("climb", settings.stableSeconds)) {
    next = "climb";
  }

  /* Detects top of climb when vertical speed becomes level. */
  if (next === "climb" && !state.hadToc && isTrendSustained("level", settings.stableSeconds)) {
    next = "TOC";
    state.hadToc = true;
  }

  /* Moves from TOC to cruise after a short marker period. */
  if (next === "TOC" && enoughTimeInCurrentPhase(point, 20)) {
    next = "cruise";
  }

  /* Detects step climb when climbing again after cruise level-off. */
  if ((next === "cruise" || next === "TOC") && !state.hadTod && isTrendSustained("climb", settings.stableSeconds)) {
    next = "climb";
  }

  /* Detects top of descent after cruise. */
  if ((next === "cruise" || next === "TOC") && !state.hadTod && isTrendSustained("descent", settings.stableSeconds)) {
    next = "TOD";
    state.hadTod = true;
  }

  /* Moves from TOD marker to descent. */
  if (next === "TOD" && enoughTimeInCurrentPhase(point, 20)) {
    next = "descent";
  }

  /* Detects approach by speed after TOD/descent. */
  if (next === "descent" && state.hadTod && speedKt <= settings.approachTriggerKt && speedKt > settings.landingSpeedKt) {
    next = "approach";
  }

  /* Detects landing after approach/descent without depending on departure elevation. */
  if ((next === "approach" || next === "descent") && state.hadTod && speedKt <= settings.landingSpeedKt) {
    next = "landing";
    state.hadLanding = true;
    state.activeSector.landingAt = state.activeSector.landingAt || point.timeIso;
  }

  /* Moves from landing to final taxi when speed becomes taxi-like. */
  if (next === "landing" && speedKt <= settings.taxiMaxKt && enoughTimeInCurrentPhase(point, 10)) {
    next = "taxi";
  }

  /* Applies phase transition. */
  if (next !== current) {
    if ((current === "cruise" || current === "TOC") && next === "climb") markLatestCruiseAsStepClimb(point.timeIso);
    setPhase(next, point.timeIso, point.timestampMs);
  }
}

/* Updates a rough ground reference before departure. */
function updateGroundReference(point) {
  /* Does nothing when altitude is missing. */
  if (point.altitudeFt === null) return;

  /* Sets the first known ground reference. */
  if (!state.hadTakeoff && state.lastGroundReferenceFt === null) {
    state.lastGroundReferenceFt = point.altitudeFt;
  }

  /* Smooths the reference while taxiing before takeoff. */
  if (!state.hadTakeoff && state.currentPhase === "taxi") {
    state.lastGroundReferenceFt = smoothValue(state.lastGroundReferenceFt, point.altitudeFt, 0.15);
  }
}

/* Checks whether a vertical-speed trend is sustained. */
function isTrendSustained(type, seconds) {
  /* Gets the latest point. */
  const last = state.activeSector.points[state.activeSector.points.length - 1];

  /* Fails if there is no latest point. */
  if (!last) return false;

  /* Defines the start of the analysis window. */
  const minTime = last.timestampMs - seconds * 1000;

  /* Filters recent points with valid vertical speed. */
  const recent = state.activeSector.points.filter((p) => p.timestampMs >= minTime && p.verticalSpeedFpm !== null);

  /* Requires enough samples. */
  if (recent.length < 3) return false;

  /* Calculates average vertical speed. */
  const avgVs = average(recent.map((p) => p.verticalSpeedFpm));

  /* Tests climb. */
  if (type === "climb") return avgVs >= settings.climbVsFpm;

  /* Tests descent. */
  if (type === "descent") return avgVs <= -settings.descentVsFpm;

  /* Tests level flight. */
  if (type === "level") return Math.abs(avgVs) <= settings.cruiseVsBandFpm;

  /* Unknown trend fails. */
  return false;
}

/* Checks if a phase has lasted long enough. */
function enoughTimeInCurrentPhase(point, seconds) {
  /* Allows transition when no phase timestamp exists. */
  if (!state.lastPhaseChangeMs) return true;

  /* Compares current point time with phase start. */
  return point.timestampMs - state.lastPhaseChangeMs >= seconds * 1000;
}

/* Converts the latest cruise segment to step climb when a new climb starts. */
function markLatestCruiseAsStepClimb(endIso) {
  /* Gets the latest log line. */
  const log = state.activeSector.logs[state.activeSector.logs.length - 1];

  /* Only re-labels an open cruise/TOC line. */
  if (!log || log.endTime || !["cruise", "TOC"].includes(log.status)) return;

  /* Closes and relabels this segment as step climb. */
  log.endTime = endIso;
  log.status = "step climb";
  log.rateLbh = settings.fuelUntilTocLbh;
  log.consumptionLb = calculateLogConsumption(log, endIso);
}

/* Adds a new phase to the current sector log. */
function setPhase(phase, timeIso, timestampMs) {
  /* Closes the previous open log line. */
  closeCurrentLog(timeIso);

  /* Stores the new current phase. */
  state.currentPhase = phase;

  /* Stores the phase timestamp. */
  state.lastPhaseChangeMs = timestampMs;

  /* Adds the new open log line. */
  state.activeSector.logs.push({
    status: phase,
    startTime: timeIso,
    endTime: null,
    consumptionLb: 0,
    rateLbh: fuelRateForStatus(phase)
  });
}

/* Closes the current log line. */
function closeCurrentLog(endIso) {
  /* Gets the last log line. */
  const log = state.activeSector.logs[state.activeSector.logs.length - 1];

  /* Exits if there is no open log. */
  if (!log || log.endTime) return;

  /* Stores the end time. */
  log.endTime = endIso;

  /* Recalculates consumption. */
  log.consumptionLb = calculateLogConsumption(log, endIso);
}

/* Checks whether the app should ask about next sector or blocks on. */
async function maybeAskAutoStop(point) {
  /* Only checks while recording. */
  if (!state.isRecording) return;

  /* Only checks after landing and during final taxi. */
  if (!state.hadLanding || state.currentPhase !== "taxi") return;

  /* Reads speed with a safe high fallback. */
  const speedKt = point.speedKt ?? 999;

  /* Resets stopped timer if speed rises. */
  if (speedKt > settings.autoStopKt) {
    stoppedSinceMs = null;
    return;
  }

  /* Starts stopped timer if needed. */
  if (stoppedSinceMs === null) {
    stoppedSinceMs = point.timestampMs;
    return;
  }

  /* Calculates stopped duration. */
  const stoppedSeconds = (point.timestampMs - stoppedSinceMs) / 1000;

  /* Waits until the threshold is reached. */
  if (stoppedSeconds < settings.autoStopSeconds || autoStopPromptOpen) return;

  /* Blocks repeated prompts. */
  autoStopPromptOpen = true;

  /* Asks the user to choose next sector or blocks on. */
  const nextSector = window.confirm("Aircraft appears stopped after final taxi. OK = save and start NEXT SECTOR. Cancel = save and stop at BLOCKS-ON.");

  /* Finalizes and optionally starts the next sector. */
  await finalizeCurrentSector(nextSector);

  /* Releases prompt lock. */
  autoStopPromptOpen = false;
}

/* Updates times and fuel totals for a sector. */
function updateSectorTotals(sector) {
  /* Updates live consumption for an open log. */
  updateOpenLogConsumption(sector);

  /* Calculates block time. */
  sector.totals.blockSeconds = secondsBetween(sector.blockOffAt, sector.blockOnAt || new Date().toISOString());

  /* Calculates flight time from airborne detection to landing detection. */
  sector.totals.flightSeconds = secondsBetween(sector.takeoffAt, sector.landingAt || (sector.takeoffAt ? new Date().toISOString() : null));

  /* Sums fuel from all phase logs. */
  sector.totals.fuelLb = sector.logs.reduce((sum, log) => sum + (Number(log.consumptionLb) || 0), 0);
}

/* Updates the currently open log consumption. */
function updateOpenLogConsumption(sector) {
  /* Gets the latest log. */
  const log = sector.logs[sector.logs.length - 1];

  /* Exits if there is no open log. */
  if (!log || log.endTime) return;

  /* Calculates live consumption up to now. */
  log.consumptionLb = calculateLogConsumption(log, new Date().toISOString());
}

/* Calculates fuel consumption for one log line. */
function calculateLogConsumption(log, fallbackEndIso) {
  /* Determines end time. */
  const endIso = log.endTime || fallbackEndIso;

  /* Returns zero when times are missing. */
  if (!log.startTime || !endIso) return 0;

  /* Calculates duration in minutes for taxi fuel. */
  const minutes = secondsBetween(log.startTime, endIso) / 60;

  /* Taxi uses 3.3 lb per minute. */
  if (log.status === "taxi") return Math.max(0, minutes * 3.3);

  /* Calculates duration in hours. */
  const hours = minutes / 60;

  /* Uses the rate stored when the phase started. */
  const rate = Number(log.rateLbh ?? fuelRateForStatus(log.status));

  /* Returns fuel in pounds. */
  return Math.max(0, hours * rate);
}

/* Returns the fuel rate for a phase. */
function fuelRateForStatus(status) {
  /* Cruise uses cruise fuel. */
  if (status === "cruise") return settings.fuelCruiseLbh;

  /* Descent side uses descent/approach fuel. */
  if (["TOD", "descent", "approach", "landing", "blocks on"].includes(status)) return settings.fuelDescentApproachLbh;

  /* Step climb uses climb fuel. */
  if (status === "step climb") return settings.fuelUntilTocLbh;

  /* Final taxi after landing uses descent/approach fuel. */
  if (status === "taxi" && state.hadLanding) return settings.fuelDescentApproachLbh;

  /* All pre-TOC phases use fuel until TOC. */
  return settings.fuelUntilTocLbh;
}

/* Attempts to identify departure and destination airports. */
async function resolveSectorAirports(sector) {
  /* Gets first and last points. */
  const first = sector.points[0];
  const last = sector.points[sector.points.length - 1];

  /* Attempts departure lookup. */
  if (first && !sector.departure) sector.departure = await lookupAirport(first);

  /* Attempts destination lookup. */
  if (last && !sector.destination) sector.destination = await lookupAirport(last);

  /* Builds an automatic sector name if both ends are known. */
  if (sector.departure && sector.destination) {
    const dep = sector.departure.icao || sector.departure.iata || sector.departure.name || "DEP";
    const dst = sector.destination.icao || sector.destination.iata || sector.destination.name || "DEST";
    sector.name = `Sector ${sector.number} ${dep}-${dst}`;
  }
}

/* Looks up the nearest airport online from coordinates. */
async function lookupAirport(point) {
  /* Skips lookup when offline. */
  if (!navigator.onLine) return null;

  /* Tries the OurAirports public CSV first because it contains ICAO-style identifiers. */
  const fromCsv = await lookupAirportFromOurAirports(point);

  /* Returns CSV result when found. */
  if (fromCsv) return fromCsv;

  /* Falls back to OpenStreetMap reverse lookup. */
  return await lookupAirportFromOsm(point);
}

/* Looks up nearest airport from the OurAirports CSV. */
async function lookupAirportFromOurAirports(point) {
  /* Defines the public CSV URL. */
  const url = "https://davidmegginson.github.io/ourairports-data/airports.csv";

  /* Tries to download and parse the CSV. */
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const text = await response.text();
    const rows = parseCsv(text);
    let best = null;

    /* Scans airports and keeps the nearest valid one. */
    for (const row of rows.slice(1)) {
      const type = row[2];
      const name = row[3];
      const lat = Number(row[4]);
      const lon = Number(row[5]);
      const ident = row[1];
      const iata = row[13];
      if (!type || type.includes("closed") || type === "heliport") continue;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const distanceKm = haversineKm(point.latitude, point.longitude, lat, lon);
      if (!best || distanceKm < best.distanceKm) {
        best = { icao: looksLikeIcao(ident) ? ident : null, iata: iata || null, name, distanceKm, source: "OurAirports" };
      }
    }

    /* Accepts only airports within a practical radius. */
    return best && best.distanceKm <= 15 ? best : null;
  } catch {
    return null;
  }
}

/* Falls back to OpenStreetMap reverse geocoding. */
async function lookupAirportFromOsm(point) {
  /* Builds a reverse geocoding URL. */
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(point.latitude)}&lon=${encodeURIComponent(point.longitude)}&zoom=14&addressdetails=1&extratags=1&namedetails=1`;

  /* Tries to get a nearby place/airport name. */
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const data = await response.json();
    const name = data?.namedetails?.name || data?.name || data?.display_name?.split(",")[0] || null;
    const icao = extractIcao(`${data?.extratags?.icao || ""} ${data?.display_name || ""}`);
    return name || icao ? { icao, iata: null, name, distanceKm: null, source: "OpenStreetMap" } : null;
  } catch {
    return null;
  }
}

/* Ensures a closed sector has a usable name. */
async function ensureSectorName(sector) {
  /* Keeps a route-derived name. */
  if (sector.name && sector.name !== `Sector ${sector.number}`) return;

  /* Creates a fallback suggestion. */
  const dep = sector.departure?.icao || sector.departure?.iata || sector.departure?.name || "DEP";
  const dst = sector.destination?.icao || sector.destination?.iata || sector.destination?.name || "DEST";
  const suggestion = dep !== "DEP" || dst !== "DEST" ? `Sector ${sector.number} ${dep}-${dst}` : `Sector ${sector.number}`;

  /* Asks the user for a sector name. */
  const name = window.prompt("Could not reliably identify departure/destination. Enter sector name:", suggestion);

  /* Stores manual or suggested name. */
  sector.name = (name && name.trim()) || suggestion;
}

/* Renders the complete UI. */
function render() {
  /* Updates buttons. */
  ui.toggleRecordBtn.textContent = state.isRecording ? "Stop" : "Start";
  ui.toggleRecordBtn.classList.toggle("is-stop", state.isRecording);

  /* Updates recording badge. */
  ui.recordingBadge.textContent = state.isRecording ? "Recording" : "Stopped";
  ui.recordingBadge.className = state.isRecording ? "badge badge-ok" : "badge badge-muted";

  /* Updates sector heading. */
  if (ui.sectorBadge) ui.sectorBadge.textContent = `Sector ${state.activeSector.number}`;
  ui.sectorName.textContent = state.activeSector.name;
  ui.sectorRoute.textContent = routeText(state.activeSector);

  /* Updates current flight status. */
  ui.flightStatus.textContent = state.currentPhase;

  /* Updates time displays. */
  updateSectorTotals(state.activeSector);
  ui.flightTime.textContent = formatDuration(state.activeSector.totals.flightSeconds);
  ui.blockTime.textContent = `Block time ${formatDuration(state.activeSector.totals.blockSeconds)}`;

  /* Reads the last GPS point. */
  const last = state.activeSector.points[state.activeSector.points.length - 1];

  /* Updates GPS-dependent values. */
  if (last) {
    ui.gpsStatus.textContent = "Active";
    ui.gpsDetails.textContent = `Accuracy ${formatNumber(last.accuracyM, 0)} m · ${formatTime(last.timeIso)}`;
    ui.speedKt.textContent = formatNumber(last.speedKt, 1);
    ui.speedMs.textContent = `${formatNumber(last.speedMs, 1)} m/s`;
    ui.altitudeFt.textContent = formatNumber(last.altitudeFt, 0);
    ui.verticalSpeed.textContent = `VS ${formatNumber(last.verticalSpeedFpm, 0)} ft/min`;
    ui.flightDetails.textContent = `Heading ${formatNumber(last.headingDeg, 0)}° · Points ${state.activeSector.points.length}`;
  } else {
    ui.gpsStatus.textContent = state.isRecording ? "Searching" : "Waiting";
    ui.gpsDetails.textContent = state.isRecording ? "Waiting for GPS fix." : "No GPS points received.";
    ui.speedKt.textContent = "—";
    ui.speedMs.textContent = "— m/s";
    ui.altitudeFt.textContent = "—";
    ui.verticalSpeed.textContent = "VS — ft/min";
    ui.flightDetails.textContent = "Start recording to detect phases.";
  }

  /* Updates tables and GPS preview. */
  renderLogTable();
  renderSectorsTable();
  renderLastPoints();
}

/* Renders the active sector log table. */
function renderLogTable() {
  /* Clears existing rows. */
  ui.logTableBody.innerHTML = "";

  /* Shows an empty state. */
  if (state.activeSector.logs.length === 0) {
    ui.logTableBody.innerHTML = '<tr><td colspan="4" class="muted">No phases recorded.</td></tr>';
    return;
  }

  /* Renders each phase row. */
  for (const log of state.activeSector.logs) {
    const row = document.createElement("tr");
    const cumulativeFuel = state.activeSector.logs.slice(0, state.activeSector.logs.indexOf(log) + 1).reduce((sum, item) => sum + (Number(item.consumptionLb) || 0), 0);
    row.innerHTML = `<td>${escapeHtml(log.status)}</td><td>${formatTime(log.startTime)}</td><td>${formatNumber(log.consumptionLb, 1)} lb</td><td>${formatNumber(cumulativeFuel, 1)} lb</td>`;
    ui.logTableBody.appendChild(row);
  }
}

/* Renders saved sectors table. */
function renderSectorsTable() {
  /* Clears the table. */
  ui.sectorsTableBody.innerHTML = "";

  /* Updates saved count. */
  ui.savedSectorCount.textContent = `${state.savedSectors.length} saved`;

  /* Shows empty state. */
  if (state.savedSectors.length === 0) {
    ui.sectorsTableBody.innerHTML = '<tr><td colspan="5" class="muted">No saved sectors yet.</td></tr>';
    return;
  }

  /* Renders saved sectors. */
  for (const sector of state.savedSectors) {
    const row = document.createElement("tr");
    row.innerHTML = `<td>Sector ${sector.number}</td><td>${escapeHtml(sector.name)}</td><td>${formatDuration(sector.totals.blockSeconds)}</td><td>${formatDuration(sector.totals.flightSeconds)}</td><td>${formatNumber(sector.totals.fuelLb, 1)} lb</td>`;
    ui.sectorsTableBody.appendChild(row);
  }
}

/* Renders the last five GPS points. */
function renderLastPoints() {
  /* Updates point count. */
  ui.pointCount.textContent = `${state.activeSector.points.length} points`;

  /* Prepares the last five points. */
  const points = state.activeSector.points.slice(-5).map((p) => ({ time: formatTime(p.timeIso), lat: round(p.latitude, 6), lon: round(p.longitude, 6), altFt: round(p.altitudeFt, 0), speedKt: round(p.speedKt, 1), vsFpm: round(p.verticalSpeedFpm, 0) }));

  /* Shows preview text. */
  ui.lastPoints.textContent = points.length ? JSON.stringify(points, null, 2) : "No data.";
}

/* Builds the current route text. */
function routeText(sector) {
  /* Gets departure label. */
  const dep = sector.departure?.icao || sector.departure?.iata || sector.departure?.name || "—";

  /* Gets destination label. */
  const dst = sector.destination?.icao || sector.destination?.iata || sector.destination?.name || "—";

  /* Returns readable route text. */
  return `Departure ${dep} · Destination ${dst}`;
}

/* Sets GPS status text. */
function setGpsStatus(status, details) {
  /* Updates GPS title. */
  ui.gpsStatus.textContent = status;

  /* Updates GPS details. */
  ui.gpsDetails.textContent = details;
}

/* Switches tabs. */
function setTab(tab) {
  /* Calculates whether flight tab is active. */
  const isFlight = tab === "flight";

  /* Shows/hides panels. */
  ui.tabFlight.classList.toggle("active", isFlight);
  ui.tabSettings.classList.toggle("active", !isFlight);

  /* Updates the tab switch button label to show the destination page. */
  ui.tabSwitchBtn.textContent = isFlight ? "Settings" : "Flight";
}

/* Alternates between the two main tabs. */
function toggleTab() {
  /* Checks whether the flight panel is currently visible. */
  const isFlightVisible = ui.tabFlight.classList.contains("active");

  /* Opens the opposite tab. */
  setTab(isFlightVisible ? "settings" : "flight");
}

/* Loads settings from localStorage. */
function loadSettings() {
  /* Attempts to parse saved settings. */
  try { return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}

/* Writes settings into form fields. */
function fillSettingsForm() {
  /* Loops through every setting input. */
  for (const key of Object.keys(settingInputs)) settingInputs[key].value = settings[key];
}

/* Saves settings from form fields. */
function saveSettingsFromForm() {
  /* Reads all values as numbers. */
  for (const key of Object.keys(settingInputs)) settings[key] = Number(settingInputs[key].value);

  /* Saves settings. */
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

  /* Confirms save. */
  alert("Settings saved.");
}

/* Restores default settings. */
function restoreDefaultSettings() {
  /* Copies defaults. */
  settings = { ...DEFAULT_SETTINGS };

  /* Saves defaults. */
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

  /* Updates form. */
  fillSettingsForm();
}

/* Saves current state to localStorage. */
function saveState() {
  /* Stores a JSON copy locally. */
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

/* Loads state from localStorage. */
function loadState() {
  /* Attempts to parse saved state. */
  try { return JSON.parse(localStorage.getItem(STATE_KEY)); }
  catch { return null; }
}

/* Deletes all local data. */
async function resetAll(skipConfirm = false) {
  /* Asks for confirmation. */
  if (!skipConfirm) {
    if (!window.confirm("Delete all active and saved sectors from this device?")) return;
  }

  /* Stops GPS if needed. */
  await stopGpsOnly();

  /* Resets state. */
  state = createInitialState();

  /* Removes saved state. */
  localStorage.removeItem(STATE_KEY);

  /* Resets auto-stop. */
  stoppedSinceMs = null;
  autoStopPromptOpen = false;

  /* Renders the clean UI. */
  render();
}

/* Exports all sectors to CSV. */
function exportCsv() {
  /* Gets sectors to export. */
  const sectors = exportableSectors();

  /* Defines CSV headers. */
  const rows = [["sector_number", "sector_name", "departure", "destination", "status", "start_time", "end_time", "consumption_lb", "consumption_cumulative_lb", "block_time", "flight_time", "total_fuel_lb"]];

  /* Adds one row per phase. */
  for (const sector of sectors) {
    updateSectorTotals(sector);
    for (const log of sector.logs) {
      const idx = sector.logs.indexOf(log);
      const cumulativeFuel = sector.logs.slice(0, idx + 1).reduce((sum, item) => sum + (Number(item.consumptionLb) || 0), 0);
      rows.push([sector.number, sector.name, sector.departure?.icao || sector.departure?.iata || sector.departure?.name || "", sector.destination?.icao || sector.destination?.iata || sector.destination?.name || "", log.status, log.startTime, log.endTime || "", round(log.consumptionLb, 1), round(cumulativeFuel, 1), formatDuration(sector.totals.blockSeconds), formatDuration(sector.totals.flightSeconds), round(sector.totals.fuelLb, 1)]);
    }
  }

  /* Downloads CSV. */
  downloadTextFile("flight-sectors.csv", "text/csv", rows.map((row) => row.map(csvCell).join(",")).join("\n"));
}

/* Exports all sectors to JSON. */
function exportJson() {
  /* Builds export payload. */
  const payload = { exportedAt: new Date().toISOString(), settings, sectors: exportableSectors() };

  /* Downloads JSON. */
  downloadTextFile("flight-sectors.json", "application/json", JSON.stringify(payload, null, 2));
}

/* Returns sectors that should be exported. */
function exportableSectors() {
  /* Clones saved sectors. */
  const sectors = state.savedSectors.map(clone);

  /* Adds the active sector if it contains data and is not closed/saved. */
  if (state.activeSector.logs.length > 0 && !state.activeSector.blockOnAt) sectors.push(clone(state.activeSector));

  /* Returns all exportable sectors. */
  return sectors;
}

/* Downloads a generated text file. */
function downloadTextFile(filename, mimeType, content) {
  /* Creates a Blob. */
  const blob = new Blob([content], { type: mimeType });

  /* Creates a temporary URL. */
  const url = URL.createObjectURL(blob);

  /* Creates a temporary link. */
  const a = document.createElement("a");

  /* Defines link target. */
  a.href = url;

  /* Defines download filename. */
  a.download = filename;

  /* Adds link to document. */
  document.body.appendChild(a);

  /* Starts download. */
  a.click();

  /* Removes link. */
  a.remove();

  /* Releases the temporary URL. */
  URL.revokeObjectURL(url);
}

/* Escapes a CSV cell. */
function csvCell(value) {
  /* Converts nullish values to empty text. */
  const text = value === null || value === undefined ? "" : String(value);

  /* Escapes double quotes. */
  return `"${text.replaceAll('"', '""')}"`;
}

/* Requests a screen wake lock. */
async function requestWakeLock() {
  /* Exits if unsupported. */
  if (!("wakeLock" in navigator)) return;

  /* Tries to keep the screen awake. */
  try { wakeLock = await navigator.wakeLock.request("screen"); }
  catch { wakeLock = null; }
}

/* Releases the wake lock. */
async function releaseWakeLock() {
  /* Exits if there is no lock. */
  if (!wakeLock) return;

  /* Tries to release it. */
  try { await wakeLock.release(); } catch {}

  /* Clears reference. */
  wakeLock = null;
}

/* Restores wake lock when returning to the visible page. */
document.addEventListener("visibilitychange", async () => {
  /* Requests wake lock again when visible and recording. */
  if (state.isRecording && document.visibilityState === "visible") await requestWakeLock();
});

/* Starts the one-second UI timer. */
function startUiTimer() {
  /* Clears a previous timer if it exists. */
  if (uiTimerId) clearInterval(uiTimerId);

  /* Updates time values every second. */
  uiTimerId = setInterval(() => { if (state.activeSector) { updateSectorTotals(state.activeSector); renderLogTable(); ui.flightTime.textContent = formatDuration(state.activeSector.totals.flightSeconds); ui.blockTime.textContent = `Block time ${formatDuration(state.activeSector.totals.blockSeconds)}`; } }, 1000);
}

/* Registers the service worker. */
function registerServiceWorker() {
  /* Exits if service workers are unsupported. */
  if (!("serviceWorker" in navigator)) return;

  /* Registers on page load. */
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

/* Parses a simple CSV into arrays. */
function parseCsv(text) {
  /* Stores parsed rows. */
  const rows = [];

  /* Stores the current row and cell. */
  let row = [], cell = "", inQuotes = false;

  /* Reads the file character by character. */
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') { cell += '"'; i++; }
    else if (char === '"') inQuotes = !inQuotes;
    else if (char === "," && !inQuotes) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }

  /* Adds the final cell. */
  if (cell || row.length) { row.push(cell); rows.push(row); }

  /* Returns rows. */
  return rows;
}

/* Calculates distance between two coordinates. */
function haversineKm(lat1, lon1, lat2, lon2) {
  /* Defines Earth radius in kilometres. */
  const r = 6371;

  /* Converts degrees to radians. */
  const toRad = (v) => v * Math.PI / 180;

  /* Calculates deltas. */
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);

  /* Calculates haversine value. */
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  /* Returns distance. */
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* Checks whether a text looks like an ICAO code. */
function looksLikeIcao(value) {
  /* Tests four capital letters/numbers, but prefers ICAO-like airport identifiers. */
  return /^[A-Z][A-Z0-9]{3}$/.test(value || "");
}

/* Extracts an ICAO-looking code from text. */
function extractIcao(text) {
  /* Finds a four-letter uppercase code. */
  const match = String(text || "").match(/\b[A-Z]{4}\b/);

  /* Returns the code or null. */
  return match ? match[0] : null;
}

/* Converts metres per second to knots. */
function msToKnots(ms) {
  /* Returns null if speed is missing. */
  if (ms === null || ms === undefined || Number.isNaN(ms)) return null;

  /* Converts m/s to kt. */
  return ms * 1.94384449;
}

/* Converts metres to feet. */
function metersToFeet(meters) {
  /* Returns null if altitude is missing. */
  if (meters === null || meters === undefined || Number.isNaN(meters)) return null;

  /* Converts metres to feet. */
  return meters * 3.280839895;
}

/* Calculates an average. */
function average(values) {
  /* Returns zero for empty arrays. */
  if (!values.length) return 0;

  /* Sums and divides. */
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/* Smooths a numeric value. */
function smoothValue(previous, next, weight) {
  /* Uses the new value when previous is missing. */
  if (previous === null || previous === undefined) return next;

  /* Applies exponential smoothing. */
  return previous * (1 - weight) + next * weight;
}

/* Calculates seconds between two ISO dates. */
function secondsBetween(startIso, endIso) {
  /* Returns zero if dates are missing. */
  if (!startIso || !endIso) return 0;

  /* Calculates positive seconds. */
  return Math.max(0, (new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000);
}

/* Formats a number for display. */
function formatNumber(value, decimals) {
  /* Returns dash when missing. */
  if (value === null || value === undefined || Number.isNaN(value)) return "—";

  /* Formats the value. */
  return Number(value).toFixed(decimals);
}

/* Rounds a value for compact export/display. */
function round(value, decimals) {
  /* Returns null for missing values. */
  if (value === null || value === undefined || Number.isNaN(value)) return null;

  /* Rounds to the requested precision. */
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/* Formats an ISO time as local time. */
function formatTime(iso) {
  /* Returns dash if missing. */
  if (!iso) return "—";

  /* Formats in Portuguese 24-hour style. */
  return new Date(iso).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/* Formats seconds as HH:MM:SS. */
function formatDuration(seconds) {
  /* Normalizes seconds. */
  const total = Math.max(0, Math.floor(seconds || 0));

  /* Calculates components. */
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;

  /* Returns padded duration. */
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

/* Escapes HTML text. */
function escapeHtml(value) {
  /* Converts to string and escapes dangerous characters. */
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

/* Creates a deep JSON clone. */
function clone(value) {
  /* Uses structuredClone if available. */
  if (typeof structuredClone === "function") return structuredClone(value);

  /* Falls back to JSON cloning. */
  return JSON.parse(JSON.stringify(value));
}
