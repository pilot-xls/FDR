/*
  Flight Data Recorder PWA
  Este ficheiro trata de:
  - pedir GPS com navigator.geolocation.watchPosition();
  - guardar pontos em IndexedDB;
  - detectar fases do voo por regras configuráveis;
  - preencher a tabela de log;
  - exportar dados em CSV e JSON;
  - registar o service worker para modo offline.
*/

/* Define a lista fixa de estados/fases que a app pode registar. */
const FLIGHT_PHASES = [
  "taxi",
  "takeoff roll",
  "take-off",
  "take off climb",
  "climb",
  "TOC",
  "cruise",
  "TOD",
  "Descent",
  "Approach",
  "Landing",
  "Landing roll",
  "taxi"
];

/* Define as configurações padrão do algoritmo de detecção. */
const DEFAULT_SETTINGS = {
  taxiMaxKt: 20,
  takeoffRollKt: 35,
  liftoffKt: 50,
  climbVsFpm: 300,
  descentVsFpm: 300,
  stableSeconds: 45,
  cruiseVsBandFpm: 180,
  approachHeightFt: 1500,
  landingRollKt: 35,
  minGpsIntervalSeconds: 2
};

/* Define a chave usada para guardar settings no localStorage. */
const SETTINGS_KEY = "flightDataRecorderSettings";

/* Define a chave usada para guardar o estado resumido da sessão no localStorage. */
const SESSION_KEY = "flightDataRecorderSession";

/* Guarda o identificador devolvido por watchPosition para podermos parar o GPS. */
let watchId = null;

/* Guarda uma referência ao bloqueio de ecrã, se o browser suportar Wake Lock. */
let wakeLock = null;

/* Guarda o estado actual da gravação e do algoritmo. */
let state = {
  isRecording: false,
  currentPhase: "—",
  startedAt: null,
  stoppedAt: null,
  points: [],
  logs: [],
  lastLandingReferenceFt: null,
  lastPhaseChangeMs: 0,
  hadTakeoff: false,
  hadToc: false,
  hadTod: false,
  hadLanding: false
};

/* Lê as settings gravadas localmente ou usa os valores padrão. */
let settings = loadSettings();

/* Guarda referências aos elementos da interface para evitar pesquisas repetidas no DOM. */
const ui = {
  recordingBadge: document.getElementById("recordingBadge"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  resetBtn: document.getElementById("resetBtn"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),
  exportJsonBtn: document.getElementById("exportJsonBtn"),
  gpsStatus: document.getElementById("gpsStatus"),
  gpsDetails: document.getElementById("gpsDetails"),
  flightStatus: document.getElementById("flightStatus"),
  flightDetails: document.getElementById("flightDetails"),
  speedKt: document.getElementById("speedKt"),
  speedMs: document.getElementById("speedMs"),
  altitudeFt: document.getElementById("altitudeFt"),
  verticalSpeed: document.getElementById("verticalSpeed"),
  logTableBody: document.getElementById("logTableBody"),
  pointCount: document.getElementById("pointCount"),
  lastPoints: document.getElementById("lastPoints"),
  tabFlight: document.getElementById("tabFlight"),
  tabSettings: document.getElementById("tabSettings"),
  flightTabBtn: document.getElementById("flightTabBtn"),
  settingsTabBtn: document.getElementById("settingsTabBtn"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  defaultSettingsBtn: document.getElementById("defaultSettingsBtn")
};

/* Guarda referências aos campos de settings. */
const settingInputs = {
  taxiMaxKt: document.getElementById("taxiMaxKt"),
  takeoffRollKt: document.getElementById("takeoffRollKt"),
  liftoffKt: document.getElementById("liftoffKt"),
  climbVsFpm: document.getElementById("climbVsFpm"),
  descentVsFpm: document.getElementById("descentVsFpm"),
  stableSeconds: document.getElementById("stableSeconds"),
  cruiseVsBandFpm: document.getElementById("cruiseVsBandFpm"),
  approachHeightFt: document.getElementById("approachHeightFt"),
  landingRollKt: document.getElementById("landingRollKt"),
  minGpsIntervalSeconds: document.getElementById("minGpsIntervalSeconds")
};

/* Inicializa a aplicação quando o ficheiro é carregado. */
init();

/* Configura listeners, carrega estado guardado e regista o service worker. */
function init() {
  /* Liga o botão Start à função que inicia a gravação. */
  ui.startBtn.addEventListener("click", startRecording);

  /* Liga o botão Stop à função que pára a gravação. */
  ui.stopBtn.addEventListener("click", stopRecording);

  /* Liga o botão Reset à função que limpa a sessão. */
  ui.resetBtn.addEventListener("click", resetSession);

  /* Liga a exportação CSV ao respectivo botão. */
  ui.exportCsvBtn.addEventListener("click", exportCsv);

  /* Liga a exportação JSON ao respectivo botão. */
  ui.exportJsonBtn.addEventListener("click", exportJson);

  /* Liga o separador Flight ao botão de navegação. */
  ui.flightTabBtn.addEventListener("click", () => setTab("flight"));

  /* Liga o separador Settings ao botão de navegação. */
  ui.settingsTabBtn.addEventListener("click", () => setTab("settings"));

  /* Guarda settings quando o utilizador carrega no botão. */
  ui.saveSettingsBtn.addEventListener("click", saveSettingsFromForm);

  /* Repõe settings padrão quando o utilizador carrega no botão. */
  ui.defaultSettingsBtn.addEventListener("click", restoreDefaultSettings);

  /* Preenche o formulário de settings com os valores actuais. */
  fillSettingsForm();

  /* Carrega uma sessão anterior, caso exista. */
  loadSession();

  /* Actualiza a interface com o estado carregado. */
  render();

  /* Regista o service worker para permitir uso offline. */
  registerServiceWorker();
}

/* Inicia a gravação de pontos GPS. */
async function startRecording() {
  /* Verifica se o browser suporta a API de geolocalização. */
  if (!("geolocation" in navigator)) {
    /* Mostra erro quando não há suporte de geolocalização. */
    setGpsStatus("Erro", "Este browser não suporta geolocalização.");
    return;
  }

  /* Marca a sessão como activa. */
  state.isRecording = true;

  /* Guarda a hora de início da sessão se ainda não existir. */
  state.startedAt = state.startedAt || new Date().toISOString();

  /* Actualiza botões e indicadores imediatamente. */
  render();

  /* Tenta manter o ecrã activo nos browsers que suportam Screen Wake Lock. */
  await requestWakeLock();

  /* Inicia a monitorização contínua de GPS. */
  watchId = navigator.geolocation.watchPosition(
    /* Recebe uma posição quando o sistema actualiza o GPS. */
    handlePosition,

    /* Recebe um erro quando a localização falha ou é recusada. */
    handleGeoError,

    /* Define opções de precisão e timing da geolocalização. */
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 15000
    }
  );

  /* Mostra que estamos à espera do primeiro ponto GPS. */
  setGpsStatus("A procurar", "A aguardar primeiro ponto GPS de alta precisão.");
}

/* Pára a gravação de pontos GPS. */
async function stopRecording() {
  /* Cancela watchPosition se estiver activo. */
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  /* Fecha a fase actual com a hora actual. */
  closeCurrentLog(new Date().toISOString());

  /* Marca a sessão como parada. */
  state.isRecording = false;

  /* Guarda a hora de paragem. */
  state.stoppedAt = new Date().toISOString();

  /* Liberta o Wake Lock, se existir. */
  await releaseWakeLock();

  /* Guarda a sessão actualizada no armazenamento local. */
  saveSession();

  /* Actualiza a interface. */
  render();
}

/* Limpa a sessão actual depois de confirmação do utilizador. */
async function resetSession() {
  /* Pede confirmação para evitar apagar dados por acidente. */
  const ok = window.confirm("Queres mesmo apagar a sessão actual e todos os pontos gravados?");

  /* Aborta o reset se o utilizador cancelar. */
  if (!ok) return;

  /* Pára a gravação se estiver activa. */
  if (state.isRecording) {
    await stopRecording();
  }

  /* Limpa o estado em memória. */
  state = {
    isRecording: false,
    currentPhase: "—",
    startedAt: null,
    stoppedAt: null,
    points: [],
    logs: [],
    lastLandingReferenceFt: null,
    lastPhaseChangeMs: 0,
    hadTakeoff: false,
    hadToc: false,
    hadTod: false,
    hadLanding: false
  };

  /* Remove o resumo da sessão do localStorage. */
  localStorage.removeItem(SESSION_KEY);

  /* Apaga os pontos guardados na IndexedDB. */
  await clearPointsDb();

  /* Actualiza a interface. */
  render();
}

/* Trata uma posição GPS recebida por watchPosition. */
async function handlePosition(position) {
  /* Converte a posição bruta para um objecto interno normalizado. */
  const point = normalisePosition(position);

  /* Ignora pontos recebidos demasiado perto do anterior para reduzir ruído. */
  if (shouldSkipPoint(point)) {
    return;
  }

  /* Adiciona o ponto ao array em memória. */
  state.points.push(point);

  /* Guarda o ponto na IndexedDB para sobreviver a refreshes da página. */
  await savePointToDb(point);

  /* Detecta a fase do voo com base no ponto novo e no histórico. */
  detectPhase(point);

  /* Guarda o resumo da sessão no localStorage. */
  saveSession();

  /* Mostra dados actualizados no ecrã. */
  render();
}

/* Trata erros da API de geolocalização. */
function handleGeoError(error) {
  /* Define uma mensagem amigável de acordo com o tipo de erro. */
  const messageByCode = {
    1: "Permissão de localização recusada.",
    2: "Posição indisponível.",
    3: "Tempo esgotado ao tentar obter posição."
  };

  /* Escolhe a mensagem específica ou usa a mensagem original. */
  const message = messageByCode[error.code] || error.message || "Erro desconhecido de GPS.";

  /* Mostra o erro na interface. */
  setGpsStatus("Erro", message);

  /* Guarda a sessão para preservar dados já recolhidos. */
  saveSession();

  /* Actualiza a interface. */
  render();
}

/* Converte um objecto GeolocationPosition para uma estrutura simples. */
function normalisePosition(position) {
  /* Guarda a referência curta às coordenadas. */
  const c = position.coords;

  /* Converte a altitude de metros para pés, se existir. */
  const altitudeFt = metersToFeet(c.altitude);

  /* Converte a velocidade de metros por segundo para nós, se existir. */
  const speedKt = msToKnots(c.speed);

  /* Calcula a razão vertical usando o ponto anterior e a altitude GPS. */
  const verticalSpeedFpm = calculateVerticalSpeedFpm(position.timestamp, altitudeFt);

  /* Devolve o ponto normalizado usado pela app. */
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

/* Decide se um ponto deve ser ignorado por chegar demasiado depressa. */
function shouldSkipPoint(point) {
  /* Obtém o ponto anterior, se existir. */
  const previous = state.points[state.points.length - 1];

  /* Aceita o ponto se ainda não houver ponto anterior. */
  if (!previous) return false;

  /* Calcula a diferença em segundos entre o ponto actual e o anterior. */
  const diffSeconds = (point.timestampMs - previous.timestampMs) / 1000;

  /* Ignora o ponto se o intervalo for menor que o configurado. */
  return diffSeconds < settings.minGpsIntervalSeconds;
}

/* Calcula velocidade vertical em pés por minuto a partir da altitude GPS. */
function calculateVerticalSpeedFpm(timestampMs, altitudeFt) {
  /* Obtém o ponto anterior. */
  const previous = state.points[state.points.length - 1];

  /* Devolve null se não houver ponto anterior ou se faltar altitude. */
  if (!previous || altitudeFt === null || previous.altitudeFt === null) {
    return null;
  }

  /* Calcula diferença de tempo em minutos. */
  const diffMinutes = (timestampMs - previous.timestampMs) / 60000;

  /* Evita divisão por zero ou intervalos negativos. */
  if (diffMinutes <= 0) return null;

  /* Calcula a diferença de altitude em pés. */
  const diffFeet = altitudeFt - previous.altitudeFt;

  /* Devolve velocidade vertical em pés por minuto. */
  return diffFeet / diffMinutes;
}

/* Detecta a fase provável do voo com regras simples e ajustáveis. */
function detectPhase(point) {
  /* Obtém a fase actual antes de decidir nova fase. */
  const current = state.currentPhase;

  /* Lê a velocidade em nós com fallback para zero quando vier vazia. */
  const speedKt = point.speedKt ?? 0;

  /* Lê a razão vertical com fallback para zero quando vier vazia. */
  const vsFpm = point.verticalSpeedFpm ?? 0;

  /* Detecta se a altitude está disponível. */
  const hasAltitude = point.altitudeFt !== null;

  /* Inicializa a referência de aterragem com a primeira altitude baixa conhecida. */
  updateLandingReference(point);

  /* Começa por assumir que a fase não muda. */
  let next = current === "—" ? "taxi" : current;

  /* Detecta início de corrida de descolagem a partir de taxi. */
  if (next === "taxi" && speedKt >= settings.takeoffRollKt && !state.hadTakeoff) {
    next = "takeoff roll";
  }

  /* Detecta take-off quando há velocidade suficiente e subida positiva. */
  if (
    next === "takeoff roll" &&
    speedKt >= settings.liftoffKt &&
    (vsFpm >= settings.climbVsFpm || !hasAltitude)
  ) {
    next = "take-off";
    state.hadTakeoff = true;
  }

  /* Transita de take-off para subida inicial. */
  if (next === "take-off" && enoughTimeInCurrentPhase(point, 10)) {
    next = "take off climb";
  }

  /* Transita de subida inicial para climb quando a subida é sustentada. */
  if (
    next === "take off climb" &&
    isTrendSustained("climb", settings.stableSeconds)
  ) {
    next = "climb";
  }

  /* Detecta TOC quando deixa de haver subida sustentada depois de climb. */
  if (
    next === "climb" &&
    !state.hadToc &&
    isTrendSustained("level", settings.stableSeconds)
  ) {
    next = "TOC";
    state.hadToc = true;
  }

  /* Transita automaticamente de TOC para cruise após alguns segundos. */
  if (next === "TOC" && enoughTimeInCurrentPhase(point, 20)) {
    next = "cruise";
  }

  /* Detecta TOD quando começa descida sustentada depois de cruzeiro. */
  if (
    (next === "cruise" || next === "TOC") &&
    !state.hadTod &&
    isTrendSustained("descent", settings.stableSeconds)
  ) {
    next = "TOD";
    state.hadTod = true;
  }

  /* Transita automaticamente de TOD para Descent após alguns segundos. */
  if (next === "TOD" && enoughTimeInCurrentPhase(point, 20)) {
    next = "Descent";
  }

  /* Detecta Approach perto da referência de aterragem durante descida. */
  if (
    next === "Descent" &&
    isNearLandingReference(point) &&
    speedKt > settings.landingRollKt
  ) {
    next = "Approach";
  }

  /* Detecta Landing quando há velocidade baixa e proximidade da referência de aterragem. */
  if (
    (next === "Approach" || next === "Descent") &&
    speedKt <= settings.landingRollKt &&
    isNearLandingReference(point)
  ) {
    next = "Landing";
    state.hadLanding = true;
  }

  /* Transita de Landing para Landing roll após alguns segundos. */
  if (next === "Landing" && enoughTimeInCurrentPhase(point, 10)) {
    next = "Landing roll";
  }

  /* Termina em taxi quando a velocidade estabiliza abaixo do taxi max depois da aterragem. */
  if (
    next === "Landing roll" &&
    speedKt <= settings.taxiMaxKt &&
    enoughTimeInCurrentPhase(point, settings.stableSeconds)
  ) {
    next = "taxi";
  }

  /* Aplica a mudança de fase, se houver alteração. */
  if (next !== current) {
    setPhase(next, point.timeIso, point.timestampMs);
  }
}

/* Actualiza a referência de altitude da aterragem quando faz sentido. */
function updateLandingReference(point) {
  /* Aborta se a altitude GPS não existir. */
  if (point.altitudeFt === null) return;

  /* Define a primeira referência antes da descolagem. */
  if (!state.hadTakeoff && state.lastLandingReferenceFt === null) {
    state.lastLandingReferenceFt = point.altitudeFt;
  }

  /* Actualiza a referência no taxi inicial para aproximar do aeródromo de partida. */
  if (!state.hadTakeoff && state.currentPhase === "taxi") {
    state.lastLandingReferenceFt = smoothValue(state.lastLandingReferenceFt, point.altitudeFt, 0.15);
  }

  /* Durante approach/landing, aproxima a referência à altitude observada no fim. */
  if (state.hadTod && (state.currentPhase === "Approach" || state.currentPhase === "Landing roll")) {
    state.lastLandingReferenceFt = smoothValue(state.lastLandingReferenceFt, point.altitudeFt, 0.08);
  }
}

/* Verifica se a aeronave está perto da altitude de referência de aterragem/descolagem. */
function isNearLandingReference(point) {
  /* Quando não há altitude, usa velocidade baixa como aproximação fraca. */
  if (point.altitudeFt === null || state.lastLandingReferenceFt === null) {
    return (point.speedKt ?? 999) <= settings.landingRollKt;
  }

  /* Calcula altura relativa à referência. */
  const heightFt = Math.abs(point.altitudeFt - state.lastLandingReferenceFt);

  /* Considera perto se estiver abaixo da altura configurada. */
  return heightFt <= settings.approachHeightFt;
}

/* Confirma tendências de subida, nível ou descida durante uma janela temporal. */
function isTrendSustained(type, seconds) {
  /* Calcula o instante mínimo dos pontos a analisar. */
  const minTime = Date.now() - seconds * 1000;

  /* Filtra pontos recentes que tenham velocidade vertical válida. */
  const recent = state.points.filter((p) => p.timestampMs >= minTime && p.verticalSpeedFpm !== null);

  /* Exige pelo menos três pontos para reduzir falsos positivos. */
  if (recent.length < 3) return false;

  /* Calcula a média da velocidade vertical recente. */
  const avgVs = average(recent.map((p) => p.verticalSpeedFpm));

  /* Confirma subida sustentada. */
  if (type === "climb") return avgVs >= settings.climbVsFpm;

  /* Confirma descida sustentada. */
  if (type === "descent") return avgVs <= -settings.descentVsFpm;

  /* Confirma voo nivelado dentro da banda de cruzeiro. */
  if (type === "level") return Math.abs(avgVs) <= settings.cruiseVsBandFpm;

  /* Devolve false para tipos desconhecidos. */
  return false;
}

/* Verifica se já passou tempo suficiente na fase actual. */
function enoughTimeInCurrentPhase(point, seconds) {
  /* Se não existir hora de mudança, deixa passar. */
  if (!state.lastPhaseChangeMs) return true;

  /* Compara o timestamp actual com o momento da última mudança. */
  return point.timestampMs - state.lastPhaseChangeMs >= seconds * 1000;
}

/* Muda a fase actual e actualiza a tabela de log. */
function setPhase(phase, timeIso, timestampMs) {
  /* Fecha a linha de log anterior com o início da nova fase. */
  closeCurrentLog(timeIso);

  /* Define a nova fase actual. */
  state.currentPhase = phase;

  /* Guarda o timestamp da mudança. */
  state.lastPhaseChangeMs = timestampMs;

  /* Cria uma nova linha de log aberta. */
  state.logs.push({
    status: phase,
    startTime: timeIso,
    endTime: null
  });
}

/* Fecha a linha de log aberta, se existir. */
function closeCurrentLog(timeIso) {
  /* Obtém a última linha do log. */
  const lastLog = state.logs[state.logs.length - 1];

  /* Não faz nada se não houver linha ou se já estiver fechada. */
  if (!lastLog || lastLog.endTime) return;

  /* Fecha a linha com a hora indicada. */
  lastLog.endTime = timeIso;
}

/* Actualiza a interface completa com base no estado actual. */
function render() {
  /* Actualiza botões principais. */
  ui.startBtn.disabled = state.isRecording;
  ui.stopBtn.disabled = !state.isRecording;

  /* Actualiza badge de gravação. */
  ui.recordingBadge.textContent = state.isRecording ? "A gravar" : "Parado";
  ui.recordingBadge.className = state.isRecording ? "badge badge-ok" : "badge badge-muted";

  /* Actualiza fase principal. */
  ui.flightStatus.textContent = state.currentPhase;

  /* Obtém o último ponto, se existir. */
  const last = state.points[state.points.length - 1];

  /* Actualiza métricas se já houver GPS. */
  if (last) {
    ui.gpsStatus.textContent = "Activo";
    ui.gpsDetails.textContent = `Precisão ${formatNumber(last.accuracyM, 0)} m · ${formatTime(last.timeIso)}`;
    ui.speedKt.textContent = formatNumber(last.speedKt, 1);
    ui.speedMs.textContent = `${formatNumber(last.speedMs, 1)} m/s`;
    ui.altitudeFt.textContent = formatNumber(last.altitudeFt, 0);
    ui.verticalSpeed.textContent = `VS ${formatNumber(last.verticalSpeedFpm, 0)} ft/min`;
    ui.flightDetails.textContent = buildFlightDetails(last);
  } else {
    ui.speedKt.textContent = "—";
    ui.speedMs.textContent = "— m/s";
    ui.altitudeFt.textContent = "—";
    ui.verticalSpeed.textContent = "VS — ft/min";
  }

  /* Actualiza a tabela de fases. */
  renderLogTable();

  /* Actualiza lista de pontos recentes. */
  renderLastPoints();
}

/* Mostra a tabela de log de fases. */
function renderLogTable() {
  /* Limpa a tabela actual. */
  ui.logTableBody.innerHTML = "";

  /* Mostra linha vazia se não houver logs. */
  if (state.logs.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="3" class="muted">Sem fases registadas.</td>`;
    ui.logTableBody.appendChild(row);
    return;
  }

  /* Cria uma linha por cada entrada no log. */
  for (const log of state.logs) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(log.status)}</td>
      <td>${formatTime(log.startTime)}</td>
      <td>${log.endTime ? formatTime(log.endTime) : "—"}</td>
    `;
    ui.logTableBody.appendChild(row);
  }
}

/* Mostra os últimos pontos GPS em formato compacto. */
function renderLastPoints() {
  /* Actualiza contador total de pontos. */
  ui.pointCount.textContent = `${state.points.length} pontos`;

  /* Obtém os últimos cinco pontos. */
  const lastFive = state.points.slice(-5).map((p) => ({
    time: formatTime(p.timeIso),
    lat: round(p.latitude, 6),
    lon: round(p.longitude, 6),
    altFt: round(p.altitudeFt, 0),
    speedKt: round(p.speedKt, 1),
    vsFpm: round(p.verticalSpeedFpm, 0)
  }));

  /* Mostra mensagem simples quando não há pontos. */
  if (lastFive.length === 0) {
    ui.lastPoints.textContent = "Sem dados.";
    return;
  }

  /* Mostra os pontos como JSON formatado. */
  ui.lastPoints.textContent = JSON.stringify(lastFive, null, 2);
}

/* Cria uma descrição curta do estado do voo. */
function buildFlightDetails(point) {
  /* Calcula a altura relativa se houver referência. */
  const relFt =
    point.altitudeFt !== null && state.lastLandingReferenceFt !== null
      ? point.altitudeFt - state.lastLandingReferenceFt
      : null;

  /* Devolve uma linha resumida para a UI. */
  return `Alt ref ${formatNumber(relFt, 0)} ft · Heading ${formatNumber(point.headingDeg, 0)}°`;
}

/* Define explicitamente o estado GPS na UI. */
function setGpsStatus(status, details) {
  /* Actualiza o título do estado GPS. */
  ui.gpsStatus.textContent = status;

  /* Actualiza a linha de detalhe do GPS. */
  ui.gpsDetails.textContent = details;
}

/* Alterna entre separadores Flight e Settings. */
function setTab(tab) {
  /* Decide se o separador activo é o de voo. */
  const isFlight = tab === "flight";

  /* Activa/desactiva painel de voo. */
  ui.tabFlight.classList.toggle("active", isFlight);

  /* Activa/desactiva painel de settings. */
  ui.tabSettings.classList.toggle("active", !isFlight);

  /* Activa/desactiva botão de voo. */
  ui.flightTabBtn.classList.toggle("active", isFlight);

  /* Activa/desactiva botão de settings. */
  ui.settingsTabBtn.classList.toggle("active", !isFlight);
}

/* Lê settings do localStorage com fallback para defaults. */
function loadSettings() {
  /* Tenta ler JSON guardado. */
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));

    /* Junta defaults com valores guardados para tolerar campos novos. */
    return { ...DEFAULT_SETTINGS, ...(saved || {}) };
  } catch {
    /* Usa defaults se o JSON estiver inválido. */
    return { ...DEFAULT_SETTINGS };
  }
}

/* Preenche o formulário de settings. */
function fillSettingsForm() {
  /* Percorre cada campo conhecido de settings. */
  for (const key of Object.keys(settingInputs)) {
    /* Escreve o valor actual no input correspondente. */
    settingInputs[key].value = settings[key];
  }
}

/* Guarda settings a partir dos inputs. */
function saveSettingsFromForm() {
  /* Percorre cada campo e converte o valor para número. */
  for (const key of Object.keys(settingInputs)) {
    settings[key] = Number(settingInputs[key].value);
  }

  /* Guarda as settings no localStorage. */
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

  /* Mostra uma confirmação simples. */
  alert("Settings guardadas.");
}

/* Repõe as settings recomendadas por defeito. */
function restoreDefaultSettings() {
  /* Copia os valores padrão para as settings activas. */
  settings = { ...DEFAULT_SETTINGS };

  /* Guarda os defaults no localStorage. */
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

  /* Actualiza o formulário com os defaults. */
  fillSettingsForm();
}

/* Guarda o resumo da sessão no localStorage. */
function saveSession() {
  /* Cria uma cópia leve sem duplicar todos os pontos no localStorage. */
  const summary = {
    ...state,
    points: state.points.slice(-100)
  };

  /* Guarda o resumo em JSON. */
  localStorage.setItem(SESSION_KEY, JSON.stringify(summary));
}

/* Carrega a sessão guardada do localStorage. */
async function loadSession() {
  /* Tenta ler a sessão guardada. */
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY));

    /* Sai se não houver sessão. */
    if (!saved) return;

    /* Restaura o estado com fallback para valores seguros. */
    state = {
      ...state,
      ...saved,
      isRecording: false
    };

    /* Tenta carregar todos os pontos da IndexedDB. */
    const pointsFromDb = await getAllPointsFromDb();

    /* Usa IndexedDB se houver pontos guardados. */
    if (pointsFromDb.length > 0) {
      state.points = pointsFromDb;
    }
  } catch {
    /* Ignora sessões inválidas para não bloquear a app. */
  }
}

/* Exporta a tabela de fases para CSV. */
function exportCsv() {
  /* Define o cabeçalho do CSV. */
  const rows = [["status", "start_time", "end_time"]];

  /* Adiciona cada linha de log ao CSV. */
  for (const log of state.logs) {
    rows.push([log.status, log.startTime, log.endTime || ""]);
  }

  /* Converte as linhas para texto CSV. */
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");

  /* Descarrega o ficheiro CSV no browser. */
  downloadTextFile("flight-log.csv", "text/csv", csv);
}

/* Exporta a sessão completa para JSON. */
function exportJson() {
  /* Cria objecto completo de exportação. */
  const payload = {
    exportedAt: new Date().toISOString(),
    settings,
    session: state
  };

  /* Converte o objecto para JSON legível. */
  const json = JSON.stringify(payload, null, 2);

  /* Descarrega o ficheiro JSON no browser. */
  downloadTextFile("flight-session.json", "application/json", json);
}

/* Descarrega um ficheiro de texto gerado localmente. */
function downloadTextFile(filename, mimeType, content) {
  /* Cria um Blob com o conteúdo do ficheiro. */
  const blob = new Blob([content], { type: mimeType });

  /* Cria um URL temporário para o Blob. */
  const url = URL.createObjectURL(blob);

  /* Cria uma hiperligação temporária. */
  const a = document.createElement("a");

  /* Define o URL do ficheiro gerado. */
  a.href = url;

  /* Define o nome do ficheiro a descarregar. */
  a.download = filename;

  /* Adiciona o link ao documento para permitir click programático. */
  document.body.appendChild(a);

  /* Simula um click para iniciar download. */
  a.click();

  /* Remove o link temporário. */
  a.remove();

  /* Liberta o URL temporário da memória. */
  URL.revokeObjectURL(url);
}

/* Prepara uma célula CSV com aspas quando necessário. */
function csvCell(value) {
  /* Converte valor null/undefined para string vazia. */
  const text = value === null || value === undefined ? "" : String(value);

  /* Escapa aspas internas duplicando-as. */
  const escaped = text.replaceAll('"', '""');

  /* Envolve o texto entre aspas para CSV seguro. */
  return `"${escaped}"`;
}

/* Pede Wake Lock para manter o ecrã activo, quando suportado. */
async function requestWakeLock() {
  /* Verifica se o browser suporta Wake Lock. */
  if (!("wakeLock" in navigator)) {
    return;
  }

  /* Tenta pedir bloqueio de ecrã. */
  try {
    wakeLock = await navigator.wakeLock.request("screen");

    /* Limpa referência quando o bloqueio for libertado pelo sistema. */
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch {
    /* Ignora falhas porque a gravação GPS pode continuar sem Wake Lock. */
  }
}

/* Liberta o Wake Lock quando a gravação pára. */
async function releaseWakeLock() {
  /* Sai se não existir bloqueio activo. */
  if (!wakeLock) return;

  /* Tenta libertar o bloqueio de ecrã. */
  try {
    await wakeLock.release();
  } catch {
    /* Ignora falhas de libertação. */
  }

  /* Limpa referência local. */
  wakeLock = null;
}

/* Volta a pedir Wake Lock quando a página volta a ficar visível. */
document.addEventListener("visibilitychange", async () => {
  /* Só tenta recuperar Wake Lock se a app estiver a gravar e visível. */
  if (state.isRecording && document.visibilityState === "visible") {
    await requestWakeLock();
  }
});

/* Regista o service worker para PWA offline. */
function registerServiceWorker() {
  /* Confirma suporte de service workers no browser. */
  if (!("serviceWorker" in navigator)) return;

  /* Regista o ficheiro sw.js depois de a página carregar. */
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* Ignora erro para não interromper a app em browsers sem suporte. */
    });
  });
}

/* Converte metros por segundo para nós. */
function msToKnots(ms) {
  /* Devolve null quando a velocidade não vem no GPS. */
  if (ms === null || ms === undefined || Number.isNaN(ms)) return null;

  /* Usa o factor oficial aproximado de m/s para kt. */
  return ms * 1.94384449;
}

/* Converte metros para pés. */
function metersToFeet(meters) {
  /* Devolve null quando a altitude não vem no GPS. */
  if (meters === null || meters === undefined || Number.isNaN(meters)) return null;

  /* Usa o factor de conversão de metros para pés. */
  return meters * 3.280839895;
}

/* Calcula a média de uma lista de números. */
function average(values) {
  /* Devolve zero se a lista estiver vazia. */
  if (values.length === 0) return 0;

  /* Soma todos os valores. */
  const total = values.reduce((sum, value) => sum + value, 0);

  /* Divide pela quantidade de valores. */
  return total / values.length;
}

/* Suaviza um valor anterior com um valor novo. */
function smoothValue(previous, next, weight) {
  /* Usa o valor novo quando ainda não há anterior. */
  if (previous === null || previous === undefined) return next;

  /* Aplica média exponencial simples. */
  return previous * (1 - weight) + next * weight;
}

/* Formata números para a UI. */
function formatNumber(value, decimals) {
  /* Devolve travessão quando o valor é null/undefined/NaN. */
  if (value === null || value === undefined || Number.isNaN(value)) return "—";

  /* Formata o número com as casas decimais pedidas. */
  return Number(value).toFixed(decimals);
}

/* Arredonda valores para guardar/mostrar compacto. */
function round(value, decimals) {
  /* Devolve null quando o valor não existe. */
  if (value === null || value === undefined || Number.isNaN(value)) return null;

  /* Calcula o factor de arredondamento. */
  const factor = 10 ** decimals;

  /* Arredonda ao número de casas decimais. */
  return Math.round(value * factor) / factor;
}

/* Formata hora ISO para hora local curta. */
function formatTime(iso) {
  /* Devolve travessão quando a hora não existe. */
  if (!iso) return "—";

  /* Converte ISO para objecto Date. */
  const date = new Date(iso);

  /* Formata a hora no locale português. */
  return date.toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

/* Escapa HTML para evitar inserir texto perigoso no DOM. */
function escapeHtml(value) {
  /* Converte qualquer valor para texto. */
  const text = String(value);

  /* Substitui caracteres especiais por entidades HTML. */
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* Abre a IndexedDB da aplicação. */
function openDb() {
  /* Devolve uma Promise para usar com async/await. */
  return new Promise((resolve, reject) => {
    /* Abre ou cria a base de dados local. */
    const request = indexedDB.open("flight-data-recorder-db", 1);

    /* Cria a store na primeira versão da base de dados. */
    request.onupgradeneeded = () => {
      const db = request.result;

      /* Cria uma object store para pontos GPS, se ainda não existir. */
      if (!db.objectStoreNames.contains("points")) {
        db.createObjectStore("points", { keyPath: "id" });
      }
    };

    /* Resolve com a ligação à base de dados quando abrir. */
    request.onsuccess = () => resolve(request.result);

    /* Rejeita a Promise se houver erro. */
    request.onerror = () => reject(request.error);
  });
}

/* Guarda um ponto GPS na IndexedDB. */
async function savePointToDb(point) {
  /* Abre a base de dados local. */
  const db = await openDb();

  /* Cria uma transacção de escrita. */
  const tx = db.transaction("points", "readwrite");

  /* Guarda o ponto na store. */
  tx.objectStore("points").put(point);

  /* Devolve uma Promise que termina quando a transacção fechar. */
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

  /* Fecha a ligação à base de dados. */
  db.close();
}

/* Lê todos os pontos GPS guardados na IndexedDB. */
async function getAllPointsFromDb() {
  /* Abre a base de dados local. */
  const db = await openDb();

  /* Cria uma transacção de leitura. */
  const tx = db.transaction("points", "readonly");

  /* Pede todos os pontos guardados. */
  const request = tx.objectStore("points").getAll();

  /* Aguarda o resultado do pedido. */
  const points = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });

  /* Fecha a ligação à base de dados. */
  db.close();

  /* Ordena os pontos por timestamp antes de devolver. */
  return points.sort((a, b) => a.timestampMs - b.timestampMs);
}

/* Apaga todos os pontos da IndexedDB. */
async function clearPointsDb() {
  /* Abre a base de dados local. */
  const db = await openDb();

  /* Cria uma transacção de escrita. */
  const tx = db.transaction("points", "readwrite");

  /* Limpa todos os pontos da store. */
  tx.objectStore("points").clear();

  /* Aguarda o fim da transacção. */
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

  /* Fecha a ligação à base de dados. */
  db.close();
}
