// API Functions

import { 
  setCitiesData, setPolygonsData, setNameToCity, setFullHistory 
} from './state.js';

export async function loadStaticData() {
  const [citiesRes, polygonsRes] = await Promise.all([
    fetch('/api/cities').then(r => r.json()),
    fetch('/api/polygons').then(r => r.json())
  ]);
  const filtered = citiesRes.filter(c => c.id !== 0);
  setCitiesData(filtered);
  setPolygonsData(polygonsRes);
  const mapping = {};
  filtered.forEach(c => { mapping[c.name] = c; });
  setNameToCity(mapping);
}

export async function loadHistory() {
  const data = await fetch('/api/history').then(r => r.json());
  setFullHistory(data);
}

export async function fetchAlerts() {
  return fetch('/api/alerts').then(r => r.json());
}

export async function fetchRecentHistory() {
  const testWave = new URLSearchParams(location.search).get('testWave') === '1';
  const url = testWave ? '/api/recent-history?testWave=1' : '/api/recent-history';
  return fetch(url).then(r => r.json());
}

export async function fetchHistory() {
  return fetch('/api/history').then(r => r.json());
}

export async function fetchPredictions(cities, centerLat, centerLng, zoneSize, options = {}) {
  const { 
    orangeCities = cities, 
    redCities = [],
    redCitiesForClustering = null,
    timeElapsedMinutes = 0,
    favorites = null
  } = options;

  return fetch('/api/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      cities, 
      orangeCities,
      redCities,
      redCitiesForClustering,
      centerLat, 
      centerLng, 
      zoneSize,
      timeElapsedMinutes,
      favorites
    })
  }).then(r => r.json());
}

export async function fetchCityHistory(cityName, days) {
  return fetch(`/api/collected?city=${encodeURIComponent(cityName)}&days=${days}`).then(r => r.json());
}

export async function fetchFullCityHistory(cityName) {
  return fetch(`/api/full-history?mode=3&city=${encodeURIComponent(cityName)}`).then(r => r.json());
}

export async function fetchCollectedAlerts(days) {
  return fetch('/api/collected?days=' + days).then(r => r.json());
}

export async function fetchLeaderboard(type, days) {
  return fetch(`/api/leaderboard?type=${type}&days=${days}`).then(r => r.json());
}
