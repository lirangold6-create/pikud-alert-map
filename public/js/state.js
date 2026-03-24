// Application State Management

export let citiesData = [];
export let polygonsData = {};
export let nameToCity = {};
export let alertLayer = null;
export let waveIllustrationLayer = null;
export let selectedCityLayer = null;
export let map = null;

export let refreshTimer = null;
export let countdown = 5;
export let countdownInterval = null;
export let waveTimelineInterval = null;

export let fullHistory = [];
export let orangeAlertTimestamps = new Map();
export let selectedCity = null;
export let userMovedMap = localStorage.getItem('userMovedMap') === 'true' || false;
export let favoriteCities = JSON.parse(localStorage.getItem('favoriteCities') || '[]');

export let historyDays = 7;
export let leaderboardType = 'red';
export let leaderboardDays = 7;

// Track current map layers to enable smooth updates
export let currentAlertLayers = new Map(); // cityName -> { layer, severity, prob? }
export let currentCenterLayers = []; // [centerMarker, circle1, circle2, circle3]

export function setCitiesData(data) { citiesData = data; }
export function setPolygonsData(data) { polygonsData = data; }
export function setNameToCity(data) { nameToCity = data; }
export function setAlertLayer(layer) { alertLayer = layer; }
export function setWaveIllustrationLayer(layer) { waveIllustrationLayer = layer; }
export function setSelectedCityLayer(layer) { selectedCityLayer = layer; }
export function setMap(m) { map = m; }
export function setRefreshTimer(timer) { refreshTimer = timer; }
export function setCountdown(val) { countdown = val; }
export function setCountdownInterval(interval) { countdownInterval = interval; }
export function setWaveTimelineInterval(interval) { waveTimelineInterval = interval; }
export function setFullHistory(data) { fullHistory = data; }
export function setSelectedCity(city) { selectedCity = city; }
export function setUserMovedMap(val) { 
  userMovedMap = val;
  localStorage.setItem('userMovedMap', val ? 'true' : 'false');
}
export function setHistoryDays(days) { historyDays = days; }
export function setLeaderboardType(type) { leaderboardType = type; }
export function setLeaderboardDays(days) { leaderboardDays = days; }
