// History Tab Functions

import { 
  citiesData, nameToCity, selectedCityLayer, map, fullHistory, historyDays,
  setSelectedCity, selectedCity, setHistoryDays
} from './state.js';
import { SEVERITY_STYLES } from './config.js';
import { getTitleSeverity, isAlertOrange, isAlertRed, isAlertGreen } from './utils.js';
import { fetchCityHistory, fetchFullCityHistory, fetchCollectedAlerts, fetchPredictions, loadHistory } from './api.js';
import { isFavorite, toggleFavorite } from './favorites.js';
import { getPolygonCoords, getCityCoords, showWaveTimeline } from './map.js';

export async function selectCity(cityName) {
  setSelectedCity(cityName);
  const searchInput = document.getElementById('city-search');
  const dropdown = document.getElementById('city-dropdown');
  searchInput.value = cityName;
  dropdown.classList.remove('open');

  const content = document.getElementById('history-content');
  content.innerHTML = '<div class="no-history">טוען...</div>';

  try {
    const res = await fetchCityHistory(cityName, historyDays);
    const collectedData = res;
    
    let data;
    if (collectedData && collectedData.length > 0) {
      data = collectedData.map(h => ({
        data: h.data, 
        date: h.alertDate.split(' ')[0].split('-').reverse().join('.'),
        time: h.alertDate.split(' ')[1], 
        category: h.category, 
        category_desc: h.category_desc || h.title,
        title: h.title,
        alertDate: h.alertDate
      }));
    } else {
      const res2 = await fetchFullCityHistory(cityName);
      data = res2;
    }
    
    renderCityHistory(cityName, data);
  } catch (err) {
    console.error('History fetch error:', err);
    if (fullHistory.length === 0) await loadHistory();
    const data = fullHistory.filter(h => h.data === cityName).map(h => ({
      data: h.data, date: h.alertDate.split(' ')[0].split('-').reverse().join('.'),
      time: h.alertDate.split(' ')[1], category: h.category, category_desc: h.title,
      alertDate: h.alertDate
    }));
    renderCityHistory(cityName, data);
  }

  selectedCityLayer.clearLayers();
  const poly = getPolygonCoords(cityName);
  if (poly && poly.length > 0) {
    const polygon = L.polygon(poly, {
      color: '#6366f1', fillColor: '#6366f1', fillOpacity: 0.2, weight: 2
    }).addTo(selectedCityLayer);
    map.fitBounds(polygon.getBounds(), { padding: [100, 100], maxZoom: 14 });
  } else {
    const coords = getCityCoords(cityName);
    if (coords) {
      L.circleMarker(coords, {
        radius: 10, color: '#6366f1', fillColor: '#6366f1', fillOpacity: 0.3
      }).addTo(selectedCityLayer);
      map.setView(coords, 13);
    }
  }
}

function renderCityHistory(cityName, rawAlerts) {
  const city = nameToCity[cityName];
  const content = document.getElementById('history-content');

  if (!city) { content.innerHTML = '<div class="no-history">עיר לא נמצאה</div>'; return; }

  const cutoffMs = Date.now() - historyDays * 86400000;
  const alerts = rawAlerts.filter(a => {
    // Build full datetime string for accurate comparison
    let datetimeStr;
    if (a.date && a.time) {
      // Format: DD.MM.YYYY + HH:MM:SS -> YYYY-MM-DDTHH:MM:SS
      datetimeStr = a.date.split('.').reverse().join('-') + 'T' + a.time;
    } else if (a.alertDate) {
      // Format: YYYY-MM-DD HH:MM:SS -> YYYY-MM-DDTHH:MM:SS
      datetimeStr = a.alertDate.replace(' ', 'T');
    } else {
      return false; // No valid date
    }
    
    const alertTime = new Date(datetimeStr).getTime();
    return alertTime >= cutoffMs;
  }).sort((a, b) => {
    const tA = a.date ? a.date.split('.').reverse().join('-') + 'T' + a.time : a.alertDate;
    const tB = b.date ? b.date.split('.').reverse().join('-') + 'T' + b.time : b.alertDate;
    return tB.localeCompare(tA);
  });

  const sortedAsc = [...alerts].reverse();
  const waves = [];
  if (sortedAsc.length > 0) {
    let curr = { alerts: [sortedAsc[0]], orange: false, red: false, green: false };
    const getTime = a => new Date((a.date ? a.date.split('.').reverse().join('-') : a.alertDate?.split(' ')[0]) + 'T' + (a.time || a.alertDate?.split(' ')[1])).getTime();
    
    for (let i = 1; i < sortedAsc.length; i++) {
      if (getTime(sortedAsc[i]) - getTime(sortedAsc[i-1]) > 20 * 60000) {
        waves.push(curr);
        curr = { alerts: [], orange: false, red: false, green: false };
      }
      curr.alerts.push(sortedAsc[i]);
    }
    waves.push(curr);
  }

  let orangeWaves = 0, convertedWaves = 0, falseScares = 0, redOnlyWaves = 0;
  for (const w of waves) {
    const desc = a => a.category_desc || a.title || '';
    w.orange = w.alerts.some(a => isAlertOrange(desc(a)));
    w.red = w.alerts.some(a => isAlertRed(desc(a)));
    w.green = w.alerts.some(a => isAlertGreen(desc(a)));
    if (w.orange) {
      orangeWaves++;
      if (w.red) convertedWaves++;
      else falseScares++;
    } else if (w.red) {
      redOnlyWaves++;
    }
  }

  const convRate = orangeWaves > 0 ? Math.round(convertedWaves / orangeWaves * 100) : 0;
  const falseRate = orangeWaves > 0 ? Math.round(falseScares / orangeWaves * 100) : 0;

  const orangeWavesList = waves.filter(w => w.orange).map(w => {
    const a = w.alerts[0];
    const dateStr = a.date || a.alertDate?.split(' ')[0] || '';
    const timeStr = a.time || a.alertDate?.split(' ')[1] || '';
    const dateFormatted = dateStr ? dateStr.split('.').reverse().join('.') : '';
    const isoDate = dateStr ? dateStr.split('.').reverse().join('-') : '';
    const timePart = timeStr ? (timeStr.length >= 8 ? timeStr.substring(0, 8) : (timeStr.length === 5 ? timeStr + ':00' : timeStr)) : '';
    const isoDatetime = (isoDate && timePart) ? isoDate + ' ' + timePart : '';
    return { date: dateFormatted, time: timeStr, outcome: w.red ? 'red' : 'false', isoDatetime };
  }).reverse();
  
  window._conversionWavesDetail = orangeWavesList;
  window._conversionCityName = cityName;

  const dailyStats = {};
  for (const w of waves) {
    const d = w.alerts[0].date || w.alerts[0].alertDate?.split(' ')[0].split('-').reverse().join('.');
    if (!dailyStats[d]) dailyStats[d] = { orange: 0, red: 0, false: 0 };
    if (w.orange) {
      dailyStats[d].orange++;
      if (w.red) dailyStats[d].red++;
      else dailyStats[d].false++;
    }
  }

  const catCounts = {};
  alerts.forEach(a => {
    const d = a.category_desc || a.title || 'אחר';
    catCounts[d] = (catCounts[d] || 0) + 1;
  });

  const convColor = convRate >= 70 ? '#f87171' : convRate >= 40 ? '#fb923c' : '#4ade80';

  const star = isFavorite(cityName) ? '⭐' : '☆';
  const starClass = isFavorite(cityName) ? 'active' : 'inactive';
  
  let html = `
    <div class="selected-city-info">
      <div class="selected-city-name">
        <span class="fav-star ${starClass}" onclick="toggleFavorite('${cityName.replace(/'/g, "\\'")}');">${star}</span>
        ${city.name}
      </div>
      <div class="selected-city-zone">${city.zone || ''} ${city.name_en ? '• ' + city.name_en : ''}</div>
      ${city.countdown ? `<div class="selected-city-countdown">⏱ ${city.countdown} שניות להיכנס למרחב מוגן</div>` : ''}
      <button class="clear-btn" onclick="clearSelection()">נקה בחירה</button>
    </div>

    <div class="conversion-card" onclick="showConversionDetailModal()" role="button" tabindex="0" aria-label="לחץ לפרטי כל הגלים">
      <div class="conversion-header">סיכוי שאחרי התרעה מקדימה → תגיע אזעקה</div>
      <div style="display:flex;align-items:baseline;gap:12px">
        <div class="conversion-big" style="color:${convColor}">${convRate}%</div>
        <div style="font-size:12px;color:#888">${convertedWaves}/${orangeWaves} גלים</div>
      </div>
      <div class="conversion-label">${falseScares} פעמים קיבלת התרעה מקדימה ללא אזעקה (${falseRate}% אזעקות שווא)</div>
      <div style="font-size:10px;color:#555;margin-top:6px">לחץ לפרטי כל הגלים ›</div>
    </div>

    <div class="stats-grid">
      <div class="stat-card"><div class="stat-value red">${alerts.filter(a=>isAlertRed(a.category_desc||a.title)).length}</div><div class="stat-label">אזעקה (רקטות)</div></div>
      <div class="stat-card"><div class="stat-value amber">${alerts.filter(a=>isAlertOrange(a.category_desc||a.title)).length}</div><div class="stat-label">התרעה מקדימה (צפוי)</div></div>
      <div class="stat-card"><div class="stat-value blue">${waves.length}</div><div class="stat-label">גלי התרעות</div></div>
      <div class="stat-card"><div class="stat-value purple">${alerts.length}</div><div class="stat-label">סה"כ התרעות</div></div>
    </div>`;

  const sortedDays = Object.entries(dailyStats).sort((a,b) => {
    const da = a[0].split('.').reverse().join('-'), db = b[0].split('.').reverse().join('-');
    return da.localeCompare(db);
  });

  if (sortedDays.length > 1) {
    html += '<div class="section-title">מגמת המרה יומית (התרעה מקדימה → אזעקה)</div>';
    for (const [date, stats] of sortedDays) {
      if (stats.orange === 0) continue;
      const rate = Math.round(stats.red / stats.orange * 100);
      const fillColor = rate >= 70 ? '#ef4444' : rate >= 40 ? '#f97316' : '#22c55e';
      html += `<div class="trend-row">
        <span class="trend-date">${date.substring(0,5)}</span>
        <div class="trend-bar-bg">
          <div class="trend-bar-fill" style="width:${rate}%;background:${fillColor}"></div>
        </div>
        <span class="trend-pct">${rate}%</span>
      </div>`;
    }
  }

  if (Object.keys(catCounts).length > 0) {
    html += '<div class="section-title" style="margin-top:14px">פילוח לפי סוג</div><div class="type-breakdown">';
    for (const [name, count] of Object.entries(catCounts).sort((a,b) => b[1] - a[1])) {
      const sev = getTitleSeverity(name);
      const color = SEVERITY_STYLES[sev] ? SEVERITY_STYLES[sev].color : '#888';
      html += `<div class="type-row"><div class="type-dot" style="background:${color}"></div><div class="type-name">${name}</div><div class="type-count">${count}</div></div>`;
    }
    html += '</div>';
  }

  if (alerts.length > 0) {
    html += '<div class="section-title" style="margin-top:14px">ציר זמן</div><div class="timeline">';
    const shown = alerts.slice(0, 150);
    let prevDate = '';
    for (const alert of shown) {
      const date = alert.date || alert.alertDate?.split(' ')[0].split('-').reverse().join('.');
      const time = alert.time || alert.alertDate?.split(' ')[1] || '';
      const title = alert.category_desc || alert.title || 'התרעה';
      const sev = getTitleSeverity(title);
      const dateLabel = date !== prevDate ? `<div style="font-size:10px;color:#555;padding:6px 0 2px;direction:ltr">${date}</div>` : '';
      prevDate = date;
      
      // Add probability if alert is orange (warning)
      let probBadge = '';
      if (alert.probability != null) {
        const probColor = alert.probability >= 70 ? '#ef4444' : alert.probability >= 40 ? '#f97316' : '#fb923c';
        probBadge = `<span class="timeline-prob" style="background:${probColor};color:#fff;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;margin-left:6px">${alert.probability}%</span>`;
      }
      
      html += `${dateLabel}<div class="timeline-item sev-${sev}">
        <span class="timeline-time">${time}</span>
        <span class="timeline-title sev-${sev}"> — ${title}</span>
        ${probBadge}
      </div>`;
    }
    if (alerts.length > 150) html += `<div style="text-align:center;color:#555;font-size:11px;padding:10px 0">+${alerts.length - 150} התרעות נוספות</div>`;
    html += '</div>';
  } else {
    html += '<div class="no-history">אין התרעות בתקופה זו</div>';
  }

  content.innerHTML = html;
  
  // Fetch and inject probabilities for orange alerts asynchronously
  fetchAndInjectProbabilities(cityName, alerts);
}

export function clearSelection() {
  setSelectedCity(null);
  const searchInput = document.getElementById('city-search');
  searchInput.value = '';
  selectedCityLayer.clearLayers();
  document.getElementById('history-content').innerHTML =
    '<div class="no-history">בחר עיר כדי לראות היסטוריית התרעות</div>';
  map.setView([31.5, 34.9], 8);
}

export async function showConversionDetailModal() {
  const waves = window._conversionWavesDetail;
  const cityName = window._conversionCityName;
  if (!waves || waves.length === 0) return;

  const body = document.getElementById('conversion-modal-body');
  body.innerHTML = '<div style="padding:24px;text-align:center;color:#888">טוען...</div>';
  document.getElementById('conversion-modal-overlay').classList.add('open');

  try {
    const allAlerts = await fetchCollectedAlerts(historyDays);
    const preds = [];

    for (const w of waves) {
      let pct = null;
      let orangeCities = [];
      let redCities = [];
      let greenCities = [];
      let orangeTimes = {};
      let redTimes = {};
      let greenTimes = {};
      
      if (w.isoDatetime) {
        const waveTime = new Date(w.isoDatetime.replace(' ', 'T')).getTime();
        const mlWindowMs = 3 * 60 * 1000;
        const vizWindowMs = 12 * 60 * 1000;
        const orangeInWindow = allAlerts.filter(a => {
          const t = new Date(a.alertDate.replace(' ', 'T')).getTime();
          if (Math.abs(t - waveTime) > mlWindowMs) return false;
          return (a.title || '').includes('בדקות הקרובות');
        });
        orangeCities = [...new Set(orangeInWindow.map(a => a.data))];
        orangeInWindow.forEach(a => {
          const t = (a.alertDate || '').split(' ')[1];
          if (t && (!orangeTimes[a.data] || t < orangeTimes[a.data])) orangeTimes[a.data] = t.substring(0, 5);
        });
        
        const vizInWindow = allAlerts.filter(a => {
          const t = new Date(a.alertDate.replace(' ', 'T')).getTime();
          return t >= waveTime - vizWindowMs && t <= waveTime + vizWindowMs;
        });
        vizInWindow.filter(a => isAlertRed(a.title || '')).forEach(a => {
          redCities.push(a.data);
          const t = (a.alertDate || '').split(' ')[1];
          if (t && (!redTimes[a.data] || t < redTimes[a.data])) redTimes[a.data] = t.substring(0, 5);
        });
        redCities = [...new Set(redCities)];
        
        vizInWindow.filter(a => isAlertGreen(a.title || '')).forEach(a => {
          greenCities.push(a.data);
          const t = (a.alertDate || '').split(' ')[1];
          if (t && (!greenTimes[a.data] || t < greenTimes[a.data])) greenTimes[a.data] = t.substring(0, 5);
        });
        greenCities = [...new Set(greenCities)];
        
        if (orangeCities.length >= 3 && cityName) {
          // History: simulate the prediction as it was at orange time (no reds yet)
          const orangeCoordsH = orangeCities.map(c => nameToCity[c]).filter(x => x && x.lat != null).map(c => [c.lat, c.lng]);
          if (orangeCoordsH.length > 0) {
            const centerLat = orangeCoordsH.reduce((s, c) => s + c[0], 0) / orangeCoordsH.length;
            const centerLng = orangeCoordsH.reduce((s, c) => s + c[1], 0) / orangeCoordsH.length;
            const res = await fetchPredictions([cityName], centerLat, centerLng, orangeCities.length, {
              orangeCities: orangeCities,
              redCities: [],
              redCitiesForClustering: redCities
            });
            pct = res.predictions && res.predictions[cityName] ? res.predictions[cityName].prob : null;
            
            // Capture multi-missile info for visualization
            if (res.multiMissile && res.multiMissile.detected) {
              w.multiMissile = res.multiMissile;
            }
          }
        }
      }
      preds.push({ ...w, predPct: pct, orangeCities, redCities, greenCities, orangeTimes, redTimes, greenTimes, multiMissile: w.multiMissile });
    }

    window._conversionPreds = preds;
    body.innerHTML = preds.map((w, i) => {
      const outcomeClass = w.outcome === 'red' ? 'outcome-red' : 'outcome-false';
      const badgeClass = w.outcome === 'red' ? 'red' : 'false';
      const badgeText = w.outcome === 'red' ? 'אזעקה' : 'התרעה מקדימה בלבד';
      const timeDisplay = w.time ? (w.time.length > 5 ? w.time.substring(0, 5) : w.time) : '';
      const pctStr = w.predPct != null ? '<span class="conversion-wave-pct" title="חיזוי המודל">' + w.predPct + '%</span>' : '<span class="conversion-wave-pct" style="color:#555;font-weight:500">—</span>';
      return '<div class="conversion-wave-item conversion-wave-clickable ' + outcomeClass + '" role="button" tabindex="0" data-wave-idx="' + i + '" title="לחץ לצפייה במפה">' +
        '<div class="conversion-wave-left">' +
        '<div class="conversion-wave-date">' + (w.date || '—') + '</div>' +
        '<div class="conversion-wave-time">' + timeDisplay + '</div></div>' +
        '<div class="conversion-wave-right">' + pctStr +
        '<span class="conversion-wave-badge ' + badgeClass + '">' + badgeText + '</span></div></div>';
    }).join('');

    document.querySelectorAll('.conversion-wave-clickable').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.waveIdx, 10);
        const w = (window._conversionPreds || [])[idx];
        if (w) {
          closeConversionModal();
          showWaveTimeline(w, window._conversionCityName || '');
        }
      });
    });
  } catch (e) {
    body.innerHTML = '<div style="padding:24px;color:#f87171">שגיאה בטעינת נתונים</div>';
  }
}

export function closeConversionModal() {
  document.getElementById('conversion-modal-overlay').classList.remove('open');
}

export function initHistoryTab() {
  const searchInput = document.getElementById('city-search');
  const dropdown = document.getElementById('city-dropdown');

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    if (q.length === 0) { dropdown.classList.remove('open'); return; }
    const matches = citiesData
      .filter(c => c.name.includes(q) || (c.name_en && c.name_en.toLowerCase().includes(q.toLowerCase())))
      .slice(0, 30);
    if (matches.length === 0) { dropdown.classList.remove('open'); return; }
    dropdown.innerHTML = matches.map(c => {
      const star = isFavorite(c.name) ? '⭐ ' : '';
      return `<div class="city-option" data-name="${c.name}">
        ${star}${c.name} <span class="zone-label">${c.zone || ''}</span>
      </div>`;
    }).join('');
    dropdown.classList.add('open');
    dropdown.querySelectorAll('.city-option').forEach(opt => {
      opt.addEventListener('click', () => selectCity(opt.dataset.name));
    });
  });

  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim().length > 0) searchInput.dispatchEvent(new Event('input'));
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) dropdown.classList.remove('open');
  });

  document.querySelectorAll('.time-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setHistoryDays(parseInt(btn.dataset.days));
      if (selectedCity) selectCity(selectedCity);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('conversion-modal-overlay').classList.contains('open')) {
      closeConversionModal();
    }
  });
}

async function fetchAndInjectProbabilities(cityName, alerts) {
  try {
    const allAlerts = await fetchCollectedAlerts(historyDays);
    
    // Group alerts into waves (same logic as in renderCityHistory)
    const sortedAsc = [...alerts].reverse();
    const waves = [];
    if (sortedAsc.length > 0) {
      let curr = { alerts: [sortedAsc[0]] };
      const getTime = a => new Date((a.date ? a.date.split('.').reverse().join('-') : a.alertDate?.split(' ')[0]) + 'T' + (a.time || a.alertDate?.split(' ')[1])).getTime();
      
      for (let i = 1; i < sortedAsc.length; i++) {
        if (getTime(sortedAsc[i]) - getTime(sortedAsc[i-1]) > 20 * 60000) {
          waves.push(curr);
          curr = { alerts: [] };
        }
        curr.alerts.push(sortedAsc[i]);
      }
      waves.push(curr);
    }
    
    // For each wave, calculate probability if it's an orange alert
    for (const wave of waves) {
      const firstAlert = wave.alerts[0];
      const title = firstAlert.category_desc || firstAlert.title || '';
      
      // Only process orange (warning) alerts
      if (!isAlertOrange(title)) continue;
      
      // Build ISO datetime
      let isoDatetime = firstAlert.alertDate;
      if (firstAlert.date && firstAlert.time) {
        isoDatetime = firstAlert.date.split('.').reverse().join('-') + ' ' + firstAlert.time;
      }
      
      if (!isoDatetime) continue;
      
      const waveTime = new Date(isoDatetime.replace(' ', 'T')).getTime();
      const mlWindowMs = 3 * 60 * 1000;
      
      // Find all orange cities in this wave
      const orangeInWindow = allAlerts.filter(a => {
        const t = new Date(a.alertDate.replace(' ', 'T')).getTime();
        if (Math.abs(t - waveTime) > mlWindowMs) return false;
        return (a.title || '').includes('בדקות הקרובות');
      });
      
      const orangeCities = [...new Set(orangeInWindow.map(a => a.data))];
      
      // Find associated reds for multi-missile detection (within 15 min)
      const redInWindow = allAlerts.filter(a => {
        const t = new Date(a.alertDate.replace(' ', 'T')).getTime();
        if (t < waveTime || t > waveTime + 15 * 60 * 1000) return false;
        return (a.title || '').includes('ירי רקטות');
      });
      const redCitiesForClustering = [...new Set(redInWindow.map(a => a.data))];
      
      if (orangeCities.length >= 3) {
        const orangeCoordsT = orangeCities.map(c => nameToCity[c]).filter(x => x && x.lat != null).map(c => [c.lat, c.lng]);
        if (orangeCoordsT.length > 0) {
          const centerLat = orangeCoordsT.reduce((s, c) => s + c[0], 0) / orangeCoordsT.length;
          const centerLng = orangeCoordsT.reduce((s, c) => s + c[1], 0) / orangeCoordsT.length;
          
          try {
            const res = await fetchPredictions([cityName], centerLat, centerLng, orangeCities.length, {
              orangeCities: orangeCities,
              redCities: [],
              redCitiesForClustering: redCitiesForClustering
            });
            const prob = res.predictions && res.predictions[cityName] ? res.predictions[cityName].prob : null;
            
            if (prob != null) {
              // Find the timeline item and inject probability
              const timelineItems = document.querySelectorAll('.timeline-item');
              const targetTime = firstAlert.time || firstAlert.alertDate?.split(' ')[1] || '';
              const targetDate = firstAlert.date || firstAlert.alertDate?.split(' ')[0].split('-').reverse().join('.');
              
              timelineItems.forEach(item => {
                const itemTime = item.querySelector('.timeline-time')?.textContent?.trim();
                const itemTitle = item.querySelector('.timeline-title')?.textContent?.trim();
                
                if (itemTime === targetTime && isAlertOrange(itemTitle || '')) {
                  // Add probability badge if not already there
                  if (!item.querySelector('.timeline-prob')) {
                    const probColor = prob >= 70 ? '#ef4444' : prob >= 40 ? '#f97316' : '#fb923c';
                    const badge = document.createElement('span');
                    badge.className = 'timeline-prob';
                    badge.style.cssText = `background:${probColor};color:#fff;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;margin-left:6px`;
                    badge.textContent = prob + '%';
                    item.appendChild(badge);
                  }
                }
              });
            }
          } catch (e) {
            console.debug('Could not fetch prediction for wave:', e);
          }
        }
      }
    }
  } catch (e) {
    console.debug('Could not fetch probabilities:', e);
  }
}

// Make functions globally accessible for onclick handlers
window.clearSelection = clearSelection;
window.showConversionDetailModal = showConversionDetailModal;
window.closeConversionModal = closeConversionModal;
