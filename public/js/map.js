// Map Initialization and Management

import { 
  map, alertLayer, waveIllustrationLayer, selectedCityLayer,
  setMap, setAlertLayer, setWaveIllustrationLayer, setSelectedCityLayer,
  setUserMovedMap, waveTimelineInterval, setWaveTimelineInterval,
  nameToCity, polygonsData
} from './state.js';
import { CLUSTER_COLORS } from './config.js';

let hintTimeout = null;

export function makeMissileIcon(centerLat) {
  let bearing;
  if (centerLat > 32.5) bearing = 200;
  else if (centerLat > 31.5) bearing = 250;
  else bearing = 30;
  const rotation = bearing - 315;
  return L.divIcon({
    html: `<div class="missile-icon" style="transform:translate(-50%,-50%) rotate(${rotation}deg)">🚀</div>`,
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  });
}

function showMapHint() {
  const hint = document.getElementById('map-hint');
  if (!hint) return;
  
  hint.style.display = 'block';
  setTimeout(() => hint.classList.add('show'), 10);
  
  if (hintTimeout) clearTimeout(hintTimeout);
  hintTimeout = setTimeout(() => {
    hint.classList.remove('show');
    setTimeout(() => hint.style.display = 'none', 300);
  }, 3000);
}

function hideMapHint() {
  const hint = document.getElementById('map-hint');
  if (!hint) return;
  
  if (hintTimeout) clearTimeout(hintTimeout);
  hint.classList.remove('show');
  setTimeout(() => hint.style.display = 'none', 300);
}

export function initMap() {
  const m = L.map('map', { center: [31.5, 34.9], zoom: 8, zoomControl: false });
  L.control.zoom({ position: 'bottomleft' }).addTo(m);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19
  }).addTo(m);

  m.on('dragstart', () => { 
    console.debug('[Map] User dragged - disabling auto-fit');
    setUserMovedMap(true);
    showMapHint();
  });
  m.on('zoomstart', (e) => { 
    if (e.originalEvent) {
      console.debug('[Map] User zoomed - disabling auto-fit');
      setUserMovedMap(true);
      showMapHint();
    }
  });
  
  // Double-click to reset view (re-enable auto-fit)
  m.on('dblclick', (e) => {
    console.debug('[Map] Double-click - re-enabling auto-fit');
    setUserMovedMap(false);
    hideMapHint();
    e.preventDefault();
    // Trigger a refresh to re-fit
    if (window.refreshAlerts) {
      window.refreshAlerts();
    }
  });

  setMap(m);
  setAlertLayer(L.layerGroup().addTo(m));
  setWaveIllustrationLayer(L.layerGroup().addTo(m));
  setSelectedCityLayer(L.layerGroup().addTo(m));
}

export function getPolygonCoords(cityName) {
  const city = nameToCity[cityName];
  if (!city) return null;
  const poly = polygonsData[city.id];
  if (!poly) return null;
  return poly.map(p => [p[0], p[1]]);
}

export function getCityCoords(cityName) {
  const city = nameToCity[cityName];
  return (city && city.lat && city.lng) ? [city.lat, city.lng] : null;
}

export function addCityToLayer(layer, name, style, label) {
  const poly = getPolygonCoords(name);
  if (poly && poly.length > 0) {
    L.polygon(poly, style).addTo(layer).bindPopup('<b>' + name + '</b><br><span style="color:' + style.color + '">' + label + '</span>');
    return poly;
  }
  const coords = getCityCoords(name);
  if (coords) {
    L.circleMarker(coords, { radius: 8, color: style.color, fillColor: style.fillColor, fillOpacity: 0.6 })
      .addTo(layer).bindPopup('<b>' + name + '</b><br><span style="color:' + style.color + '">' + label + '</span>');
    return [coords];
  }
  return [];
}

export function showWaveTimeline(wave, selectedCity) {
  if (waveTimelineInterval) clearInterval(waveTimelineInterval);
  waveIllustrationLayer.clearLayers();
  
  // Hide live alert layer so history wave shows on a clean map
  if (alertLayer && map.hasLayer(alertLayer)) {
    map.removeLayer(alertLayer);
  }
  const oc = wave.orangeCities || [];
  const rc = wave.redCities || [];
  let gc = wave.greenCities || [];
  if (gc.length === 0 && oc.length > 0) gc = oc;
  const ot = wave.orangeTimes || {};
  const rt = wave.redTimes || {};
  const gt = wave.greenTimes || {};
  const orangeTime = (selectedCity && ot[selectedCity]) || Object.values(ot)[0] || wave.time || '—';
  const redTime = (selectedCity && rt[selectedCity]) || Object.values(rt)[0] || '—';
  const greenTime = (selectedCity && gt[selectedCity]) || '—';

  const bounds = [];
  const orangeStyle = { color: '#f97316', fillColor: '#f97316', fillOpacity: 0.28, weight: 2 };
  const redStyle = { color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.4, weight: 2 };
  const greenStyle = { color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.3, weight: 2 };

  for (const n of oc) bounds.push(...addCityToLayer(waveIllustrationLayer, n, orangeStyle, 'התרעה מקדימה'));
  for (const n of rc) bounds.push(...addCityToLayer(waveIllustrationLayer, n, redStyle, 'אזעקה'));
  for (const n of gc) bounds.push(...addCityToLayer(waveIllustrationLayer, n, greenStyle, 'האירוע הסתיים'));
  if (bounds.length === 0) return;
  
  // ═══ ADD CLUSTER CENTER MARKERS FOR MULTI-MISSILE WAVES ═══
  const multiMissileInfo = wave.multiMissile;
  if (multiMissileInfo && multiMissileInfo.detected) {
    multiMissileInfo.clusters.forEach((cluster, idx) => {
      const center = [cluster.center.lat, cluster.center.lng];
      const color = CLUSTER_COLORS[idx] || CLUSTER_COLORS[0];
      
      const marker = L.marker(center, { icon: makeMissileIcon(cluster.center.lat) }).addTo(waveIllustrationLayer);
      marker.bindPopup(`<b>מוקד ${idx + 1}</b><br>${cluster.seedName}<br>${cluster.size} ערים`);
      bounds.push(center);
    });
  }

  map.fitBounds(bounds, { padding: [60, 60], maxZoom: 11 });

  const phases = [
    { label: 'התרעה מקדימה', time: orangeTime, cities: oc },
    { label: 'אזעקה', time: redTime, cities: rc },
    { label: 'האירוע הסתיים', time: greenTime, cities: gc }
  ].filter(p => p.cities.length > 0);

  if (phases.length === 0) phases.push({ label: 'התרעה מקדימה', time: orangeTime, cities: oc });

  const DURATION_MS = 8000;
  const phaseDuration = DURATION_MS / phases.length;
  let phaseIdx = 0;

  let panel = document.getElementById('wave-timeline-panel');
  if (panel) panel.remove();
  panel = document.createElement('div');
  panel.id = 'wave-timeline-panel';
  panel.className = 'wave-timeline-panel';
  document.body.appendChild(panel);

  function updatePhase() {
    const p = phases[phaseIdx];
    waveIllustrationLayer.clearLayers();
    const allBounds = [];
    for (let i = 0; i <= phaseIdx; i++) {
      const ph = phases[i];
      const style = ph.label === 'התרעה מקדימה' ? orangeStyle : ph.label === 'אזעקה' ? redStyle : greenStyle;
      const lbl = ph.label;
      for (const n of ph.cities) allBounds.push(...addCityToLayer(waveIllustrationLayer, n, style, lbl));
    }
    
    // Re-add cluster markers during timeline playback
    if (multiMissileInfo && multiMissileInfo.detected && phaseIdx >= 1) {
      multiMissileInfo.clusters.forEach((cluster, idx) => {
        const center = [cluster.center.lat, cluster.center.lng];
        const color = CLUSTER_COLORS[idx] || CLUSTER_COLORS[0];
        
        L.marker(center, { icon: makeMissileIcon(cluster.center.lat) }).addTo(waveIllustrationLayer);
      });
    }
    
    const pct = ((phaseIdx + 1) / phases.length * 100);
    const barColor = p.label === 'התרעה מקדימה' ? '#f97316' : p.label === 'אזעקה' ? '#ef4444' : '#22c55e';
    
    let multiMissileTag = '';
    if (multiMissileInfo && multiMissileInfo.detected) {
      multiMissileTag = '<div class="wave-timeline-multi">⚠️ ' + multiMissileInfo.clusterCount + ' מוקדים | ' + multiMissileInfo.separation + ' ק"מ</div>';
    }
    
    panel.innerHTML = '<div class="wave-timeline-phase">' + p.label + '</div>' +
      '<div class="wave-timeline-time">' + p.time + '</div>' +
      multiMissileTag +
      '<div class="wave-timeline-bar"><div class="wave-timeline-progress" style="width:' + pct + '%;background:' + barColor + '"></div></div>';
    phaseIdx = (phaseIdx + 1) % phases.length;
  }

  updatePhase();
  setWaveTimelineInterval(setInterval(updatePhase, phaseDuration));

  let closeBtn = document.getElementById('wave-illustration-close');
  if (closeBtn) closeBtn.remove();
  closeBtn = document.createElement('button');
  closeBtn.id = 'wave-illustration-close';
  closeBtn.className = 'wave-illustration-close';
  closeBtn.textContent = 'סגור תצוגת גל';
  closeBtn.onclick = () => {
    if (waveTimelineInterval) clearInterval(waveTimelineInterval);
    setWaveTimelineInterval(null);
    waveIllustrationLayer.clearLayers();
    panel.remove();
    closeBtn.remove();
    // Restore live alert layer
    if (alertLayer && !map.hasLayer(alertLayer)) {
      map.addLayer(alertLayer);
    }
  };
  document.body.appendChild(closeBtn);
}

// Make function globally accessible
window.showWaveTimeline = showWaveTimeline;
