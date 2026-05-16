/*
  Flight Data Recorder PWA v2
  Este ficheiro trata de:
  - GPS contínuo com navigator.geolocation.watchPosition();
  - funcionamento offline com service worker;
  - gravação local em IndexedDB;
  - detecção de blocks off, taxi, takeoff, initial climb, climb, TOC, cruise, TOD, descent, approach, landing, taxi e blocks on;
  - cálculo de consumo por fase em lb;
  - auto-stop no taxi final quando a velocidade estabiliza perto de zero.
*/

/* Define as configurações padrão do algoritmo de detecção e do consumo. */
const DEFAULT_SETTINGS = {
  taxiMaxKt: 20,
  takeoffKt: 35,
  initialClimbKt: 50,
  climbVsFpm: 300,
  descentVsFpm: 300,
  stableSeconds: 45,
  cruiseVsBandFpm: 180,
  approachMaxKt: 140,
  landingMaxKt: 100,
  autoStopSpeedKt: 2,
  autoStopStableSeconds: 20,
  minGpsIntervalSeconds: 2,
  fuelBeforeTocLbh: 720,
  fuelCruiseLbh: 600,
  fuelDescentLbh: 580,
  takeoffSpeedKt: 35,
  takeoffRollKt: 35,
  initialClimbSpeedKt: 85,
  liftoffKt: 85,
  approachTriggerKt: 140,
  landingRollKt: 100,
  autoStopKt: 1,
  autoStopSeconds: 20,
  fuelUntilTocLbh: 720,
  fuelDescentApproachLbh: 580
};

/* Define a chave usada para guardar settings no localStorage. */
const SETTINGS_KEY = "flightDataRecorderSettingsV2";

/* Define a chave usada para guardar o estado resumido da sessão no localStorage. */
const SESSION_KEY = "flightDataRecorderSessionV2";

/* Guarda o identificador devolvido por watchPosition para podermos parar o GPS. */
let watchId = null;

/* Guarda uma referência ao bloqueio de ecrã, se o browser suportar Wake Lock. */
let wakeLock = null;

/* Guarda o estado actual da gravação e do algoritmo. */
let state = createEmptyState();

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
  totalFuelLb: document.getElementById("totalFuelLb"),
  currentFuelRate: document.getElementById("currentFuelRate"),
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
  takeoffKt: document.getElementById("takeoffKt"),
  initialClimbKt: document.getElementById("initialClimbKt"),
  climbVsFpm: document.getElementById("climbVsFpm"),
  descentVsFpm: document.getElementById("descentVsFpm"),
  stableSeconds: document.getElementById("stableSeconds"),
  cruiseVsBandFpm: document.getElementById("cruiseVsBandFpm"),
  approachMaxKt: document.getElementById("approachMaxKt"),
  landingMaxKt: document.getElementById("landingMaxKt"),
  autoStopSpeedKt: document.getElementById("autoStopSpeedKt"),
  autoStopStableSeconds: document.getElementById("autoStopStableSeconds"),
  minGpsIntervalSeconds: document.getElementById("minGpsIntervalSeconds"),
  fuelBeforeTocLbh: document.getElementById("fuelBeforeTocLbh"),
  fuelCruiseLbh: document.getElementById("fuelCruiseLbh"),
  fuelDescentLbh: document.getElementById("fuelDescentLbh")
};

/* Inicializa a aplicação quando o ficheiro é carregado. */
init();

/* Cria um estado vazio e consistente para uma nova sessão. */
function createEmptyState() {
  /* Devolve a estrutura base usada pela aplicação. */
  return {
    isRecording: false,
    currentPhase: "—",
    startedAt: null,
    stoppedAt: null,
    points: [],
    logs: [],
    lastPhaseChangeMs: 0,
    hadTakeoff: false,
    hadToc: false,
    hadTod: false,
    hadLanding: false,
    autoStopCandidateSinceMs: null,
    autoStopPrompted: false
  };
}

/* Configura listeners, carrega estado guardado e regista o service worker. */
function init() {
  /* Liga o botão Start à função que inicia a gravação. */
  ui.startBtn.addEventListener("click", startRecording);

  /* Liga o botão Stop à função que pára a gravação e cria blocks on. */
  ui.stopBtn.addEventListener("click", () => stopRecording("manual"));

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
  loadSession().then(() => {
    /* Actualiza a interface quando o carregamento terminar. */
    render();
  });

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

  /* Cria o evento blocks off se esta for uma sessão nova. */
  if (state.logs.length === 0) {
    /* Guarda o instante exacto do início de blocks off. */
    const nowMs = Date.now();

    /* Converte o instante actual para ISO. */
    const nowIso = new Date(nowMs).toISOString();

    /* Adiciona blocks off como evento sem consumo. */
    addEventLog("blocks off", nowIso, nowMs);

    /* Inicia a fase de taxi imediatamente após blocks off. */
    beginPhase("taxi", nowIso, nowMs);
  }

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

/* Pára a gravação de pontos GPS e cria o evento blocks on. */
async function stopRecording(reason = "manual") {
  /* Cancela watchPosition se estiver activo. */
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  /* Obtém o último ponto GPS, se existir. */
  const lastPoint = state.points[state.points.length - 1];

  /* Usa o timestamp do último ponto ou a hora actual. */
  const stopMs = lastPoint ? lastPoint.timestampMs : Date.now();

  /* Converte o timestamp escolhido para ISO. */
  const stopIso = new Date(stopMs).toISOString();

  /* Aplica uma correcção final caso a app tenha ficado presa em descent/approach. */
  applyFinalLandingCorrection(stopIso, stopMs);

  /* Fecha a fase actual com a hora de paragem. */
  closeCurrentPhase(stopIso, stopMs);

  /* Adiciona o evento blocks on ao log. */
  addEventLog("blocks on", stopIso, stopMs);

  /* Marca a fase visível como blocks on. */
  state.currentPhase = "blocks on";

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

  /* Mostra mensagem curta quando o stop veio do auto-stop. */
  if (reason === "auto") {
    setGpsStatus("Parado", "Auto-stop confirmado. Blocks on criado.");
  }
}

/* Limpa a sessão actual depois de confirmação do utilizador. */
async function resetSession() {
  /* Pede confirmação para evitar apagar dados por acidente. */
  const ok = window.confirm("Queres mesmo apagar a sessão actual e todos os pontos gravados?");

  /* Aborta o reset se o utilizador cancelar. */
  if (!ok) return;

  /* Pára a gravação se estiver activa. */
  if (state.isRecording && watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  /* Liberta o Wake Lock, se existir. */
  await releaseWakeLock();

  /* Limpa o estado em memória. */
  state = createEmptyState();

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
  if (shouldSkipPoint(point)) return;

  /* Adiciona o ponto ao array em memória. */
  state.points.push(point);

  /* Guarda o ponto na IndexedDB para sobreviver a refreshes da página. */
  await savePointToDb(point);

  /* Detecta a fase do voo com base no ponto novo e no histórico. */
  detectPhase(point);

  /* Avalia auto-stop depois da detecção de fase. */
  await checkAutoStop(point);

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
  if (!previous || altitudeFt === null || previous.altitudeFt === null) return null;

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

  /* Detecta takeoff a partir do taxi inicial. */
  if (current === "taxi" && !state.hadTakeoff && speedKt >= settings.takeoffKt) {
    setPhase("takeoff", point.timeIso, point.timestampMs);
    state.hadTakeoff = true;
    return;
  }

  /* Detecta initial climb após takeoff com velocidade suficiente e subida positiva. */
  if (
    current === "takeoff" &&
    speedKt >= settings.initialClimbKt &&
    (vsFpm >= settings.climbVsFpm || enoughTimeInCurrentPhase(point, 12))
  ) {
    setPhase("initial climb", point.timeIso, point.timestampMs);
    return;
  }

  /* Detecta climb quando a subida fica sustentada. */
  if (current === "initial climb" && isTrendSustained("climb", settings.stableSeconds, point.timestampMs)) {
    setPhase("climb", point.timeIso, point.timestampMs);
    return;
  }

  /* Detecta TOC quando deixa de haver subida sustentada depois de climb. */
  if (current === "climb" && !state.hadToc && isTrendSustained("level", settings.stableSeconds, point.timestampMs)) {
    addEventThenPhase("TOC", "cruise", point.timeIso, point.timestampMs);
    state.hadToc = true;
    return;
  }

  /* Permite detectar TOC mesmo se a app saltou initial climb e ficou em takeoff. */
  if ((current === "takeoff" || current === "initial climb") && !state.hadToc && isTrendSustained("level", settings.stableSeconds, point.timestampMs)) {
    addEventThenPhase("TOC", "cruise", point.timeIso, point.timestampMs);
    state.hadToc = true;
    return;
  }

  /* Detecta TOD quando começa descida sustentada depois de cruise. */
  if (current === "cruise" && !state.hadTod && isTrendSustained("descent", settings.stableSeconds, point.timestampMs)) {
    addEventThenPhase("TOD", "descent", point.timeIso, point.timestampMs);
    state.hadTod = true;
    return;
  }

  /* Detecta descent mesmo que TOC/cruise não tenham sido detectados, se já houve takeoff. */
  if (!state.hadTod && state.hadTakeoff && isTrendSustained("descent", settings.stableSeconds, point.timestampMs)) {
    addEventThenPhase("TOD", "descent", point.timeIso, point.timestampMs);
    state.hadTod = true;
    return;
  }

  /* Detecta approach sem depender da altitude do aeródromo de partida. */
  if (
    current === "descent" &&
    state.hadTod &&
    speedKt > settings.landingMaxKt &&
    speedKt <= settings.approachMaxKt
  ) {
    setPhase("approach", point.timeIso, point.timestampMs);
    return;
  }

  /* Detecta landing directamente de descent ou approach quando a velocidade baixa bastante depois de TOD. */
  if (
    (current === "descent" || current === "approach") &&
    state.hadTod &&
    speedKt <= settings.landingMaxKt
  ) {
    setPhase("landing", point.timeIso, point.timestampMs);
    state.hadLanding = true;
    return;
  }

  /* Detecta taxi final quando a velocidade fica abaixo do limite de taxi depois da aterragem. */
  if (
    current === "landing" &&
    state.hadLanding &&
    speedKt <= settings.taxiMaxKt &&
    enoughTimeInCurrentPhase(point, 8)
  ) {
    setPhase("taxi", point.timeIso, point.timestampMs);
    return;
  }
}

/* Aplica uma correcção final caso o voo termine com baixa velocidade mas a fase continue errada. */
function applyFinalLandingCorrection(stopIso, stopMs) {
  /* Obtém o último ponto GPS disponível. */
  const last = state.points[state.points.length - 1];

  /* Sai se não houver ponto GPS. */
  if (!last) return;

  /* Lê a velocidade com fallback para zero. */
  const speedKt = last.speedKt ?? 0;

  /* Só corrige se já houve descida ou TOD. */
  if (!state.hadTod) return;

  /* Corrige descent/approach para landing quando o avião já está muito lento. */
  if ((state.currentPhase === "descent" || state.currentPhase === "approach") && speedKt <= settings.landingMaxKt) {
    setPhase("landing", stopIso, stopMs);
    state.hadLanding = true;
  }

  /* Corrige landing para taxi quando a velocidade está dentro do limite de taxi. */
  if (state.currentPhase === "landing" && speedKt <= settings.taxiMaxKt) {
    setPhase("taxi", stopIso, stopMs);
  }
}

/* Verifica se deve perguntar se o voo terminou no taxi final. */
async function checkAutoStop(point) {
  /* Lê a velocidade com fallback para um valor alto quando não há speed. */
  const speedKt = point.speedKt ?? 999;

  /* Só usa auto-stop depois de landing, no taxi final. */
  const isFinalTaxi = state.currentPhase === "taxi" && state.hadLanding;

  /* Reinicia o candidato se não estamos em taxi final ou se a velocidade subiu. */
  if (!isFinalTaxi || speedKt > settings.autoStopSpeedKt) {
    state.autoStopCandidateSinceMs = null;
    state.autoStopPrompted = false;
    return;
  }

  /* Marca o início da paragem se ainda não estava marcado. */
  if (state.autoStopCandidateSinceMs === null) {
    state.autoStopCandidateSinceMs = point.timestampMs;
    return;
  }

  /* Calcula há quanto tempo a velocidade está perto de zero. */
  const stoppedSeconds = (point.timestampMs - state.autoStopCandidateSinceMs) / 1000;

  /* Sai se ainda não passou o tempo estável definido. */
  if (stoppedSeconds < settings.autoStopStableSeconds) return;

  /* Evita perguntar repetidamente. */
  if (state.autoStopPrompted) return;

  /* Marca que a pergunta já foi feita. */
  state.autoStopPrompted = true;

  /* Pergunta ao utilizador se o voo terminou. */
  const ended = window.confirm("A velocidade está perto de zero no taxi final. O voo terminou e queres fazer Blocks on?");

  /* Se o utilizador confirmou, pára a gravação e cria blocks on. */
  if (ended) await stopRecording("auto");
}

/* Confirma tendências de subida, nível ou descida durante uma janela temporal. */
function isTrendSustained(type, seconds, referenceMs) {
  /* Calcula o instante mínimo dos pontos a analisar. */
  const minTime = referenceMs - seconds * 1000;

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

/* Adiciona uma linha de evento sem duração nem consumo. */
function addEventLog(status, timeIso, timestampMs) {
  /* Cria a linha de evento no log. */
  state.logs.push({
    status,
    startTime: timeIso,
    startMs: timestampMs,
    endTime: timeIso,
    endMs: timestampMs,
    rateLbh: 0,
    isEvent: true
  });
}

/* Fecha a fase actual, adiciona um evento e começa uma nova fase. */
function addEventThenPhase(eventStatus, nextPhase, timeIso, timestampMs) {
  /* Fecha a fase em curso no instante do evento. */
  closeCurrentPhase(timeIso, timestampMs);

  /* Adiciona o evento ao log. */
  addEventLog(eventStatus, timeIso, timestampMs);

  /* Começa a fase seguinte no mesmo instante. */
  beginPhase(nextPhase, timeIso, timestampMs);
}

/* Muda a fase actual e actualiza a tabela de log. */
function setPhase(phase, timeIso, timestampMs) {
  /* Fecha a linha de log anterior com o início da nova fase. */
  closeCurrentPhase(timeIso, timestampMs);

  /* Começa a nova fase. */
  beginPhase(phase, timeIso, timestampMs);
}

/* Começa uma nova fase com consumo configurado. */
function beginPhase(phase, timeIso, timestampMs) {
  /* Define a nova fase actual. */
  state.currentPhase = phase;

  /* Guarda o timestamp da mudança. */
  state.lastPhaseChangeMs = timestampMs;

  /* Cria uma nova linha de log aberta. */
  state.logs.push({
    status: phase,
    startTime: timeIso,
    startMs: timestampMs,
    endTime: null,
    endMs: null,
    rateLbh: getFuelRateForPhase(phase),
    isEvent: false
  });
}

/* Fecha a linha de fase aberta, se existir. */
function closeCurrentPhase(timeIso, timestampMs) {
  /* Obtém a última linha do log. */
  const lastLog = state.logs[state.logs.length - 1];

  /* Não faz nada se não houver linha, se for evento, ou se já estiver fechada. */
  if (!lastLog || lastLog.isEvent || lastLog.endTime) return;

  /* Fecha a linha com a hora indicada. */
  lastLog.endTime = timeIso;

  /* Fecha a linha com o timestamp indicado. */
  lastLog.endMs = timestampMs;
}

/* Devolve a razão de consumo para uma fase nova. */
function getFuelRateForPhase(phase) {
  /* Eventos não têm consumo. */
  if (phase === "blocks off" || phase === "blocks on" || phase === "TOC" || phase === "TOD") return 0;

  /* Fases antes de TOC usam 720 lb/h por defeito. */
  if (!state.hadToc && ["taxi", "takeoff", "initial climb", "climb"].includes(phase)) return settings.fuelBeforeTocLbh;

  /* Cruise usa 600 lb/h por defeito. */
  if (phase === "cruise") return settings.fuelCruiseLbh;

  /* Fases depois de TOD usam 580 lb/h por defeito. */
  if (["descent", "approach", "landing", "taxi"].includes(phase)) return settings.fuelDescentLbh;

  /* Usa zero para qualquer fase desconhecida. */
  return 0;
}

/* Calcula o consumo de uma linha de log. */
function calculateLogConsumptionLb(log) {
  /* Eventos têm consumo zero. */
  if (log.isEvent) return 0;

  /* Usa o fim da fase se existir, caso contrário usa o último ponto ou agora. */
  const endMs = log.endMs || getCurrentCalculationMs();

  /* Evita durações negativas. */
  const durationMs = Math.max(0, endMs - log.startMs);

  /* Converte duração para horas. */
  const hours = durationMs / 3600000;

  /* Multiplica horas pelo consumo horário da fase. */
  return hours * (log.rateLbh || 0);
}

/* Calcula o consumo total actual da sessão. */
function calculateTotalFuelLb() {
  /* Soma o consumo de todas as linhas do log. */
  return state.logs.reduce((sum, log) => sum + calculateLogConsumptionLb(log), 0);
}

/* Obtém o timestamp a usar para consumos dinâmicos. */
function getCurrentCalculationMs() {
  /* Obtém o último ponto GPS disponível. */
  const last = state.points[state.points.length - 1];

  /* Usa o timestamp do último ponto se a app está a gravar. */
  if (state.isRecording && last) return last.timestampMs;

  /* Usa agora como fallback. */
  return Date.now();
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
    ui.gpsStatus.textContent = state.isRecording ? "Activo" : "Parado";
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

  /* Actualiza total de combustível. */
  ui.totalFuelLb.textContent = formatNumber(calculateTotalFuelLb(), 1);

  /* Actualiza fuel rate actual. */
  ui.currentFuelRate.textContent = `Rate ${formatNumber(getCurrentFuelRate(), 0)} lb/h`;

  /* Actualiza a tabela de fases. */
  renderLogTable();

  /* Actualiza lista de pontos recentes. */
  renderLastPoints();
}

/* Obtém a razão de consumo da linha aberta actual. */
function getCurrentFuelRate() {
  /* Obtém a última linha do log. */
  const lastLog = state.logs[state.logs.length - 1];

  /* Devolve zero se não houver linha ou se a última linha for evento. */
  if (!lastLog || lastLog.isEvent) return 0;

  /* Devolve a razão de consumo da fase actual. */
  return lastLog.rateLbh || 0;
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
    const consumption = calculateLogConsumptionLb(log);
    row.innerHTML = `
      <td>${escapeHtml(log.status)}</td>
      <td>${formatTime(log.startTime)}</td>
      <td>${formatNumber(consumption, 1)} lb</td>
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
  /* Devolve uma linha resumida para a UI. */
  return `Heading ${formatNumber(point.headingDeg, 0)}° · TOC ${state.hadToc ? "sim" : "não"} · TOD ${state.hadTod ? "sim" : "não"}`;
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
      ...createEmptyState(),
      ...saved,
      isRecording: false
    };

    /* Tenta carregar todos os pontos da IndexedDB. */
    const pointsFromDb = await getAllPointsFromDb();

    /* Usa IndexedDB se houver pontos guardados. */
    if (pointsFromDb.length > 0) state.points = pointsFromDb;
  } catch {
    /* Ignora sessões inválidas para não bloquear a app. */
  }
}

/* Exporta a tabela de fases para CSV. */
function exportCsv() {
  /* Define o cabeçalho do CSV. */
  const rows = [["status", "start_time", "consumption_lb", "rate_lb_per_hour", "end_time"]];

  /* Adiciona cada linha de log ao CSV. */
  for (const log of state.logs) {
    rows.push([
      log.status,
      log.startTime,
      calculateLogConsumptionLb(log).toFixed(1),
      log.rateLbh || 0,
      log.endTime || ""
    ]);
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
    totalFuelLb: calculateTotalFuelLb(),
    session: state,
    computedLogs: state.logs.map((log) => ({
      ...log,
      consumptionLb: calculateLogConsumptionLb(log)
    }))
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
  if (!("wakeLock" in navigator)) return;

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
  if (state.isRecording && document.visibilityState === "visible") await requestWakeLock();
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

  /* Usa o factor aproximado de m/s para kt. */
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
    const request = indexedDB.open("flight-data-recorder-db-v2", 1);

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
