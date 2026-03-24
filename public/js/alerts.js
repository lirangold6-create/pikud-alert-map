// Live Alerts Tab

import { 
  alertLayer, map, orangeAlertTimestamps, favoriteCities, userMovedMap, selectedCity,
  countdownInterval, setCountdownInterval, countdown, setCountdown, refreshTimer, setRefreshTimer,
  nameToCity, currentAlertLayers, currentCenterLayers
} from './state.js';
import { selectCity } from './history.js';
import { SEVERITY_STYLES, CLUSTER_COLORS, CLUSTER_NAMES, getThreatLevel, formatRemainingTime } from './config.js';
import { 
  getTitleSeverity, haversineKm, centroid, distToProb, probToClass, 
  probToColor, probLabel 
} from './utils.js';
import { fetchAlerts, fetchRecentHistory, fetchHistory, fetchPredictions } from './api.js';
import { isFavorite } from './favorites.js';
import { getPolygonCoords, getCityCoords, makeMissileIcon } from './map.js';

function assignCitiesToCluster(cities, multiMissileInfo, clusterIdx) {
  return cities.filter(c => {
    const coords = getCityCoords(c.name);
    if (!coords || !multiMissileInfo.clusters[0] || !multiMissileInfo.clusters[1]) return false;
    const dists = multiMissileInfo.clusters.map(cl =>
      haversineKm(coords[0], coords[1], cl.center.lat, cl.center.lng)
    );
    const nearest = dists.indexOf(Math.min(...dists));
    return nearest === clusterIdx;
  });
}

export async function refreshAlerts() {
  
  try {
    let alertRes, historyRes;
    try {
      [alertRes, historyRes] = await Promise.all([
        fetchAlerts(),
        fetchRecentHistory()
      ]);
    } catch (fetchErr) {
      historyRes = await fetchHistory().catch(() => []);
      alertRes = await fetchAlerts().catch(() => ({ active: false, alerts: null }));
    }
    if (!Array.isArray(historyRes)) historyRes = [];
    if (!alertRes || typeof alertRes !== 'object') alertRes = { active: false, alerts: null };

    const statusEl = document.getElementById('status');
    const contentEl = document.getElementById('alert-content');

    const now = Date.now();
    const recentCities = new Map();
    if (historyRes && historyRes.length > 0) {
      for (const h of historyRes) {
        const alertTime = new Date(h.alertDate.replace(' ', 'T')).getTime();
        if (now - alertTime > 1800000) continue;
        const city = h.data;
        if (!recentCities.has(city) || new Date(h.alertDate.replace(' ', 'T')) > new Date(recentCities.get(city).alertDate.replace(' ', 'T'))) {
          recentCities.set(city, h);
        }
      }
    }

    if (alertRes.active && alertRes.alerts) {
      const alert = alertRes.alerts;
      const cities = alert.data || [];
      for (const city of cities) {
        if (!recentCities.has(city)) {
          recentCities.set(city, { data: city, title: alert.title, category: parseInt(alert.cat), alertDate: new Date().toISOString() });
        }
      }
    }

    // Declare these OUTSIDE the if block so they're accessible throughout the function
    let predRes = null;
    let redCenter = null;
    let orangeWithProb = [];
    const groups = { red: [], orange: [], green: [] };

    if (recentCities.size > 0) {
      for (const [cityName, alert] of recentCities) {
        const title = alert.title || alert.category_desc || '';
        const sev = getTitleSeverity(title);
        groups[sev].push({ name: cityName, title, time: alert.alertDate });
        
        if (sev === 'orange' && !orangeAlertTimestamps.has(cityName)) {
          const alertTime = alert.alertDate ? new Date(alert.alertDate.replace(' ', 'T')).getTime() : Date.now();
          orangeAlertTimestamps.set(cityName, alertTime);
        }
      }

      // Expire stale oranges: if green events exist, orange alerts older than
      // the latest green are from a finished attack — move them to green
      if (groups.green.length > 0 && groups.orange.length > 0) {
        const latestGreenTime = Math.max(...groups.green.map(c => 
          c.time ? new Date(c.time.replace(' ', 'T')).getTime() : 0
        ));
        const stillActive = [];
        for (const c of groups.orange) {
          const t = c.time ? new Date(c.time.replace(' ', 'T')).getTime() : Date.now();
          if (t >= latestGreenTime) {
            stillActive.push(c);
          }
        }
        groups.orange = stillActive;
      }

      // If we only have red cities (no orange from API), auto-discover orange zone
      if (groups.orange.length === 0 && groups.red.length > 0) {
        const redCoords = groups.red.map(c => getCityCoords(c.name)).filter(Boolean);
        const autoCenter = centroid(redCoords);
        if (autoCenter) {
          const redSet = new Set(groups.red.map(c => c.name));
          const greenSet = new Set(groups.green.map(c => c.name));
          const ORANGE_RADIUS_KM = 50;
          for (const [name, city] of Object.entries(nameToCity)) {
            if (redSet.has(name) || greenSet.has(name)) continue;
            if (!city.lat || !city.lng) continue;
            const dist = haversineKm(city.lat, city.lng, autoCenter[0], autoCenter[1]);
            if (dist <= ORANGE_RADIUS_KM) {
              groups.orange.push({ name, title: '', time: null });
              if (!orangeAlertTimestamps.has(name)) {
                orangeAlertTimestamps.set(name, Date.now());
              }
            }
          }
        }
      }
      
      const orangeCityNames = new Set(groups.orange.map(c => c.name));
      for (const [city] of orangeAlertTimestamps) {
        if (!orangeCityNames.has(city)) {
          orangeAlertTimestamps.delete(city);
        }
      }

      // Missile target center: use RED cities when they're part of the SAME attack.
      // If reds are far from the orange zone (different attack), use orange center.
      const orangeCoords = groups.orange.map(c => getCityCoords(c.name)).filter(Boolean);
      const redCoordsList = groups.red.map(c => getCityCoords(c.name)).filter(Boolean);
      const orangeCenter = orangeCoords.length > 0 ? centroid(orangeCoords) : null;
      const redCentroid = redCoordsList.length > 0 ? centroid(redCoordsList) : null;
      
      if (redCentroid && orangeCenter) {
        const dist = haversineKm(redCentroid[0], redCentroid[1], orangeCenter[0], orangeCenter[1]);
        redCenter = dist < 60 ? redCentroid : orangeCenter;
      } else {
        redCenter = redCentroid || orangeCenter;
      }

      if (groups.orange.length > 0 && redCenter) {
        try {
          const orangeNames = groups.orange.map(c => c.name);
          const redCityNames = groups.red.map(c => c.name);
          
          const orangeTimes = groups.orange
            .map(c => c.time ? new Date(c.time.replace(' ', 'T')).getTime() : null)
            .filter(Boolean);
          const earliestOrange = orangeTimes.length > 0 ? Math.min(...orangeTimes) : Date.now();
          const timeElapsedMinutes = (Date.now() - earliestOrange) / 60000;
          
          predRes = await fetchPredictions(
            orangeNames, 
            redCenter[0], 
            redCenter[1], 
            groups.orange.length,
            {
              orangeCities: orangeNames,
              redCities: redCityNames,
              redCitiesForClustering: redCityNames,
              timeElapsedMinutes,
              favorites: favoriteCities.length > 0 ? [...favoriteCities] : null
            }
          );
          orangeWithProb = groups.orange.map(c => {
            const pred = predRes.predictions ? predRes.predictions[c.name] : null;
            const coords = getCityCoords(c.name);
            let dist = null;
            if (coords && redCenter) {
              dist = haversineKm(coords[0], coords[1], redCenter[0], redCenter[1]);
            }
            const prob = pred ? pred.prob : (dist !== null ? Math.round(distToProb(dist)) : 50);
            return {
              ...c, prob, dist,
              mlProb: pred ? pred.ml : null,
              distProb: pred ? pred.dist : null,
              source: pred ? pred.source : 'distance_curve',
              probClass: probToClass(prob),
              estimatedArrivalMinutes: pred ? pred.estimatedArrivalMinutes : null
            };
          }).sort((a, b) => b.prob - a.prob);
        } catch (err) {
          console.error('[Predict] Error:', err);
          orangeWithProb = groups.orange.map(c => {
            const coords = getCityCoords(c.name);
            let dist = null, prob = 50;
            if (coords && redCenter) {
              dist = haversineKm(coords[0], coords[1], redCenter[0], redCenter[1]);
              prob = Math.round(distToProb(dist));
            }
            return { ...c, prob, dist, mlProb: null, distProb: prob, source: 'distance_curve', probClass: probToClass(prob) };
          }).sort((a, b) => b.prob - a.prob);
        }
      }

      const redCount = groups.red.length;
      const orangeCount = groups.orange.length;
      const greenCount = groups.green.length;

      let statusHtml = '';
      if (redCount > 0) {
        statusHtml += `<div class="status-bar active"><div class="pulse red"></div>ירי רקטות וטילים — ${redCount} אזורים</div>`;
      }
      
      // Wave-centric status for orange alerts
      if (orangeCount > 0 && redCenter && predRes) {
        const earliestOrangeTime = Math.min(...Array.from(orangeAlertTimestamps.values()));
        const elapsedMinutes = (Date.now() - earliestOrangeTime) / 60000;
        const multiMissileInfo = predRes.multiMissile;

        if (multiMissileInfo && multiMissileInfo.detected) {
          statusHtml += `
            <div class="wave-alert-card multi-missile">
              <div class="wave-alert-header">
                <div class="wave-alert-icon">⚠️</div>
                <div class="wave-alert-title">איום מרובה - ${multiMissileInfo.clusterCount} טילים זוהו</div>
              </div>
              <div class="wave-alert-subtitle">מרחק בין מוקדים: ${multiMissileInfo.separation} ק"מ</div>
            </div>`;

          multiMissileInfo.clusters.forEach((cluster, idx) => {
            const center = [cluster.center.lat, cluster.center.lng];
            const color = CLUSTER_COLORS[idx] || CLUSTER_COLORS[0];
            const clusterCities = assignCitiesToCluster(orangeWithProb, multiMissileInfo, idx);
            const estimates = clusterCities.filter(c => c.estimatedArrivalMinutes > 0);
            const time = formatRemainingTime(estimates, elapsedMinutes);
            const avgProb = clusterCities.length > 0
              ? Math.round(clusterCities.reduce((s, c) => s + c.prob, 0) / clusterCities.length) : 50;
            const threat = getThreatLevel(avgProb);

            statusHtml += `
              <div class="wave-alert-card cluster-card" style="border-right: 4px solid ${color}">
                <div class="wave-alert-header">
                  <div class="wave-alert-icon" style="color:${color}">🎯</div>
                  <div class="wave-alert-title">טיל ${CLUSTER_NAMES[idx] || idx + 1} - ${cluster.seedName}</div>
                </div>
                <div class="wave-alert-body">
                  <div class="wave-stat"><span class="wave-stat-label">ישובים באזור</span><span class="wave-stat-value">${clusterCities.length}</span></div>
                  <div class="wave-stat"><span class="wave-stat-label">זמן צפוי</span><span class="wave-stat-value wave-timer cluster-${idx}" data-remaining="${time.remaining}" data-start-time="${earliestOrangeTime}">${time.display}</span></div>
                  <div class="wave-stat"><span class="wave-stat-label">רמת איום</span><span class="wave-stat-value" style="color:${color}">${threat.label} (${avgProb}%)</span></div>
                  <div class="wave-target"><span class="wave-target-label">🎯 מוקד:</span><span class="wave-target-coords">${center[0].toFixed(3)}, ${center[1].toFixed(3)}</span></div>
                </div>
              </div>`;
          });
        } else {
          const estimates = orangeWithProb.filter(c => c.estimatedArrivalMinutes > 0);
          const time = formatRemainingTime(estimates, elapsedMinutes);
          const avgProb = orangeWithProb.length > 0
            ? Math.round(orangeWithProb.reduce((s, c) => s + c.prob, 0) / orangeWithProb.length) : 50;
          const threat = getThreatLevel(avgProb);

          statusHtml += `
            <div class="wave-alert-card">
              <div class="wave-alert-header"><div class="wave-alert-icon">🚀</div><div class="wave-alert-title">איום פעיל - גל התקפה</div></div>
              <div class="wave-alert-body">
                <div class="wave-stat"><span class="wave-stat-label">איזור התרעה</span><span class="wave-stat-value">${orangeCount} ישובים</span></div>
                <div class="wave-stat"><span class="wave-stat-label">זמן צפוי לאזעקה</span><span class="wave-stat-value wave-timer" data-remaining="${time.remaining}" data-start-time="${earliestOrangeTime}">${time.display}</span></div>
                <div class="wave-stat"><span class="wave-stat-label">רמת איום</span><span class="wave-stat-value" style="color:${threat.color}">${threat.label} (${avgProb}%)</span></div>
                <div class="wave-target"><span class="wave-target-label">🎯 מוקד צפוי:</span><span class="wave-target-coords">${redCenter[0].toFixed(3)}, ${redCenter[1].toFixed(3)}</span></div>
              </div>
            </div>`;
        }
      }
      
      if (greenCount > 0) {
        statusHtml += `<div class="status-bar safe"><div class="pulse green"></div>האירוע הסתיים — ${greenCount} אזורים</div>`;
      }
      statusEl.innerHTML = statusHtml;

      let listHtml = '';

      if (favoriteCities.length > 0) {
        listHtml += '<div class="favorites-section"><div class="favorites-header"><span>⭐ ערים מועדפות</span><span>' + favoriteCities.length + '</span></div>';
        
        for (const favCity of favoriteCities) {
          const inRed = groups.red.find(c => c.name === favCity);
          const inOrange = orangeWithProb.find(c => c.name === favCity);
          const inGreen = groups.green.find(c => c.name === favCity);
          
          let statusHtml = '<span class="fav-status safe">Safe</span>';
          if (inRed) {
            statusHtml = '<span class="fav-status danger">אדום 🚨</span>';
          } else if (inOrange) {
            const estArrival = inOrange.estimatedArrivalMinutes;
            if (estArrival && estArrival > 0) {
              const orangeStartTime = orangeAlertTimestamps.get(favCity);
              let remainingMinutes = estArrival;
              
              if (orangeStartTime) {
                const elapsedMinutes = (Date.now() - orangeStartTime) / 60000;
                remainingMinutes = Math.max(0, estArrival - elapsedMinutes);
              }
              
              statusHtml = `<span class="fav-status warning">${inOrange.prob}%</span>`;
            } else {
              statusHtml = `<span class="fav-status warning">${inOrange.prob}% סיכוי</span>`;
            }
          } else if (inGreen) {
            statusHtml = '<span class="fav-status safe">הסתיים ✓</span>';
          }
          
          listHtml += `<div class="fav-city" onclick="viewCityHistory('${favCity.replace(/'/g, "\\'")}')">
            <span class="fav-star active" role="button" tabindex="0" aria-label="הסר ממועדפים ${favCity}" onclick="event.stopPropagation(); toggleFavorite('${favCity.replace(/'/g, "\\'")}')">⭐</span>
            <span class="fav-city-name">${favCity}</span>
            ${statusHtml}
          </div>`;
        }
        listHtml += '</div>';
      }

      if (groups.red.length > 0) {
        listHtml += `<div class="alert-group">
          <div class="alert-type-badge badge-red">ירי רקטות וטילים — היכנסו למרחב מוגן</div>
          <ul class="city-list">
            ${groups.red.map(c => {
              const city = nameToCity[c.name];
              const cd = city ? city.countdown : null;
              const cdLabel = cd !== null ? `<span class="countdown-label">${cd}s</span>` : '';
              const star = isFavorite(c.name) ? '⭐' : '☆';
              return `<li class="severity-red">
                <span class="fav-star ${isFavorite(c.name) ? 'active' : 'inactive'}" role="button" tabindex="0" aria-label="הוסף למועדפים ${c.name}" onclick="toggleFavorite('${c.name.replace(/'/g, "\\'")}'); event.stopPropagation();">${star}</span>
                ${cdLabel}${c.name}
              </li>`;
            }).join('')}
          </ul>
        </div>`;
      }

      if (orangeWithProb.length > 0) {
        // Collapsible zone details - cleaner UI
        const topCities = orangeWithProb.slice(0, 5).map(c => c.name).join(', ');
        const moreCount = orangeWithProb.length > 5 ? ` +${orangeWithProb.length - 5} נוספים` : '';
        
        listHtml += `<details class="orange-zone-details">
          <summary class="orange-zone-summary">
            <span class="zone-icon">🟠</span>
            <span class="zone-title">איזור התרעה (${orangeWithProb.length} ישובים)</span>
            <span class="zone-toggle">▼</span>
          </summary>
          <div class="orange-zone-preview">${topCities}${moreCount}</div>
          <div class="orange-zone-list">
            ${orangeWithProb.sort((a, b) => b.prob - a.prob).map(c => {
              const star = isFavorite(c.name) ? '⭐' : '☆';
              const pColor = probToColor(c.prob);
              return `<div class="orange-zone-city">
                <span class="fav-toggle" data-city="${c.name}" onclick="toggleFavorite('${c.name.replace(/'/g, "\\'")}'); event.stopPropagation();">${star}</span>
                <span class="zone-city-name">${c.name}</span>
                <span class="zone-city-prob" style="background:${pColor.fill};color:${pColor.color};border:1px solid ${pColor.color}">${c.prob}%</span>
              </div>`;
            }).join('')}
          </div>
        </details>`;
      }

      if (groups.green.length > 0) {
        listHtml += `<div class="alert-group">
          <div class="alert-type-badge badge-green">האירוע הסתיים — ניתן לצאת מהמרחב המוגן</div>
          <ul class="city-list">
            ${groups.green.map(c => {
              const star = isFavorite(c.name) ? '⭐' : '☆';
              return `<li class="severity-green">
                <span class="fav-star ${isFavorite(c.name) ? 'active' : 'inactive'}" role="button" tabindex="0" aria-label="הוסף למועדפים ${c.name}" onclick="toggleFavorite('${c.name.replace(/'/g, "\\'")}'); event.stopPropagation();">${star}</span>
                ${c.name}
              </li>`;
            }).join('')}
          </ul>
        </div>`;
      }

      contentEl.innerHTML = listHtml;

      // Smooth map update: only change what's different
      const newCityData = new Map(); // cityName -> { severity, prob?, data }
      
      // Build new state
      for (const c of groups.red) {
        newCityData.set(c.name, { severity: 'red', data: c });
      }
      for (const c of orangeWithProb) {
        newCityData.set(c.name, { severity: 'orange', prob: c.prob, data: c });
      }
      for (const c of groups.green) {
        newCityData.set(c.name, { severity: 'green', data: c });
      }
      
      // Detect if alerts have changed BEFORE updating (for auto-fit logic)
      const oldCitySet = new Set(currentAlertLayers.keys());
      const newCitySet = new Set(newCityData.keys());
      const alertsChanged = (
        oldCitySet.size !== newCitySet.size ||
        Array.from(newCitySet).some(city => !oldCitySet.has(city)) ||
        Array.from(oldCitySet).some(city => !newCitySet.has(city))
      );
      
      // Remove cities no longer in alerts
      for (const [cityName, layerInfo] of currentAlertLayers) {
        if (!newCityData.has(cityName)) {
          alertLayer.removeLayer(layerInfo.layer);
          currentAlertLayers.delete(cityName);
        }
      }
      
      // Update or add cities
      for (const c of groups.red) {
        const existing = currentAlertLayers.get(c.name);
        const needsUpdate = !existing || existing.severity !== 'red';
        
        if (needsUpdate) {
          // Remove old layer if exists
          if (existing) {
            alertLayer.removeLayer(existing.layer);
          }
          
          // Add new layer
          const style = SEVERITY_STYLES.red;
          const poly = getPolygonCoords(c.name);
          let layer;
          
          if (poly && poly.length > 0) {
            layer = L.polygon(poly, {
              color: style.color, fillColor: style.fill,
              fillOpacity: style.fillOpacity, weight: 2
            }).addTo(alertLayer).bindPopup(`<b>${c.name}</b><br><span style="color:#f87171">ירי רקטות וטילים — היכנסו למרחב מוגן</span>`);
          } else {
            const coords = getCityCoords(c.name);
            if (coords) {
              layer = L.circleMarker(coords, {
                radius: 8, color: style.color, fillColor: style.fill, fillOpacity: 0.6
              }).addTo(alertLayer).bindPopup(`<b>${c.name}</b><br><span style="color:#f87171">ירי רקטות וטילים</span>`);
            }
          }
          
          if (layer) {
            currentAlertLayers.set(c.name, { layer, severity: 'red' });
          }
        }
      }

      for (const c of orangeWithProb) {
        const existing = currentAlertLayers.get(c.name);
        const needsUpdate = !existing || existing.severity !== 'orange' || existing.prob !== c.prob;
        
        if (needsUpdate) {
          // Remove old layer if exists
          if (existing) {
            alertLayer.removeLayer(existing.layer);
          }
          
          // Add new layer
          const pColor = probToColor(c.prob);
          const srcLine = c.source === 'blended'
            ? `<span style="font-size:10px;color:#818cf8">ML: ${c.mlProb}% | Dist: ${c.distProb}%</span>`
            : `<span style="font-size:10px;color:#888">Distance curve</span>`;
          const popupHtml = `
            <div style="text-align:center;min-width:160px">
              <b>${c.name}</b><br>
              <span style="font-size:28px;font-weight:800;color:${pColor.color}">${c.prob}%</span><br>
              <span style="font-size:12px;color:#ccc">${probLabel(c.prob)}</span><br>
              <span style="font-size:11px;color:#aaa">${c.dist !== null ? c.dist.toFixed(1) + ' km ממוקד הפגיעה' : ''}</span><br>
              ${srcLine}
            </div>`;
          const tooltipText = `${c.name} — ${c.prob}%`;

          const poly = getPolygonCoords(c.name);
          let layer;
          
          if (poly && poly.length > 0) {
            layer = L.polygon(poly, {
              color: pColor.color, fillColor: pColor.fill,
              fillOpacity: pColor.opacity, weight: c.prob >= 70 ? 2 : 1
            }).addTo(alertLayer).bindPopup(popupHtml)
              .bindTooltip(tooltipText, { sticky: true, direction: 'top', className: 'prob-tooltip' });
          } else {
            const coords = getCityCoords(c.name);
            if (coords) {
              layer = L.circleMarker(coords, {
                radius: c.prob >= 70 ? 8 : c.prob >= 30 ? 6 : 4,
                color: pColor.color, fillColor: pColor.fill,
                fillOpacity: pColor.opacity + 0.15
              }).addTo(alertLayer).bindPopup(popupHtml)
                .bindTooltip(tooltipText, { sticky: true, direction: 'top', className: 'prob-tooltip' });
            }
          }
          
          if (layer) {
            currentAlertLayers.set(c.name, { layer, severity: 'orange', prob: c.prob });
          }
        }
      }

      for (const c of groups.green) {
        const existing = currentAlertLayers.get(c.name);
        const needsUpdate = !existing || existing.severity !== 'green';
        
        if (needsUpdate) {
          // Remove old layer if exists
          if (existing) {
            alertLayer.removeLayer(existing.layer);
          }
          
          // Add new layer
          const style = SEVERITY_STYLES.green;
          const poly = getPolygonCoords(c.name);
          let layer;
          
          if (poly && poly.length > 0) {
            layer = L.polygon(poly, {
              color: style.color, fillColor: style.fill,
              fillOpacity: style.fillOpacity, weight: 1
            }).addTo(alertLayer).bindPopup(`<b>${c.name}</b><br><span style="color:#4ade80">האירוע הסתיים</span>`);
          } else {
            const coords = getCityCoords(c.name);
            if (coords) {
              layer = L.circleMarker(coords, {
                radius: 6, color: style.color, fillColor: style.fill, fillOpacity: 0.3
              }).addTo(alertLayer).bindPopup(`<b>${c.name}</b><br><span style="color:#4ade80">האירוע הסתיים</span>`);
            }
          }
          
          if (layer) {
            currentAlertLayers.set(c.name, { layer, severity: 'green' });
          }
        }
      }
      
      // Track bounds for all current alerts
      const bounds = [];
      for (const [cityName] of newCityData) {
        const poly = getPolygonCoords(cityName);
        if (poly && poly.length > 0) {
          bounds.push(...poly);
        } else {
          const coords = getCityCoords(cityName);
          if (coords) bounds.push(coords);
        }
      }

      // Update center marker and circles - Multi-missile aware visualization
      const needsCenterUpdate = (
        (redCenter && orangeWithProb.length > 0 && currentCenterLayers.length === 0) ||
        (!redCenter && currentCenterLayers.length > 0) ||
        (predRes && predRes.multiMissile)  // Always update if multi-missile info available
      );
      
      if (needsCenterUpdate) {
        // Remove old center layers
        currentCenterLayers.forEach(layer => alertLayer.removeLayer(layer));
        currentCenterLayers.length = 0;
        
        // Add new visualization
        if (redCenter && orangeWithProb.length > 0 && predRes) {
          const multiMissileInfo = predRes.multiMissile;
          
          if (multiMissileInfo && multiMissileInfo.detected) {
            multiMissileInfo.clusters.forEach((cluster, idx) => {
              const center = [cluster.center.lat, cluster.center.lng];
              const color = CLUSTER_COLORS[idx] || CLUSTER_COLORS[0];
              const clusterCities = assignCitiesToCluster(orangeWithProb, multiMissileInfo, idx);
              const avgProb = clusterCities.length > 0
                ? Math.round(clusterCities.reduce((s, c) => s + c.prob, 0) / clusterCities.length) : 50;

              const impactZone = L.circle(center, {
                radius: 8 * 1000,
                color: color,
                fillColor: color,
                fillOpacity: 0.2,
                weight: 2,
                dashArray: '10 5',
                interactive: false,
                className: `impact-zone-cluster-${idx}`
              }).addTo(alertLayer);
              currentCenterLayers.push(impactZone);
              
              const centerMarker = L.marker(center, { icon: makeMissileIcon(cluster.center.lat) }).addTo(alertLayer);
              centerMarker.bindPopup(`<b>מוקד ${idx + 1}</b><br>${cluster.seedName}<br>${cluster.size} ערים<br>איום: ${avgProb}%`);
              currentCenterLayers.push(centerMarker);
            });
          } 
          // ═══ SINGLE-MISSILE: Show one center ═══
          else {
            const avgProb = orangeWithProb.reduce((sum, c) => sum + c.prob, 0) / orangeWithProb.length;
            const threatColor = avgProb >= 70 ? '#ef4444' : avgProb >= 40 ? '#f97316' : '#fb923c';
            
            // Predicted impact zone (non-interactive so clicks pass through to cities)
            const impactZone = L.circle(redCenter, {
              radius: 10 * 1000,
              color: threatColor,
              fillColor: threatColor,
              fillOpacity: 0.25,
              weight: 2,
              interactive: false,
              className: 'impact-zone-circle'
            }).addTo(alertLayer);
            currentCenterLayers.push(impactZone);
            
            // Warning radius circles
            [20, 35].forEach((r, i) => {
              const opacity = 0.12 - (i * 0.04);
              const circle = L.circle(redCenter, {
                radius: r * 1000,
                color: 'rgba(251,146,60,0.4)',
                fillColor: 'rgba(251,146,60,0.1)',
                fillOpacity: opacity,
                weight: 1.5,
                dashArray: '8 6',
                interactive: false
              }).addTo(alertLayer);
              currentCenterLayers.push(circle);
            });
            
            const centerMarker = L.marker(redCenter, { icon: makeMissileIcon(redCenter[0]) }).addTo(alertLayer);
            centerMarker.bindPopup(`<b>מוקד התקפה משוער</b><br>${redCenter[0].toFixed(4)}°N, ${redCenter[1].toFixed(4)}°E<br>איומים באזור: ${orangeWithProb.length} ישובים`);
            currentCenterLayers.push(centerMarker);
          }
        }
      }

      // Only auto-fit bounds when: alerts changed AND user hasn't moved AND not viewing specific city
      const shouldAutoFit = alertsChanged && !userMovedMap && !selectedCity;
      
      if (shouldAutoFit) {
        console.debug('[Auto-fit] Alerts changed, fitting bounds:', {
          oldCities: Array.from(oldCitySet),
          newCities: Array.from(newCitySet),
          boundsCount: bounds.length
        });
        
        if (bounds.length > 0) {
          map.fitBounds(bounds, { padding: [80, 80], maxZoom: 12 });
        } else if (orangeWithProb.length > 0) {
          const orangeCoords = orangeWithProb.map(c => getCityCoords(c.name)).filter(Boolean);
          if (orangeCoords.length > 0) map.fitBounds(orangeCoords, { padding: [80, 80], maxZoom: 11 });
        }
      } else {
        console.debug('[Auto-fit] Skipped:', {
          alertsChanged,
          userMovedMap,
          selectedCity,
          reason: !alertsChanged ? 'No change' : userMovedMap ? 'User moved map' : 'Selected city'
        });
      }
    } else {
      // No active alerts - clear all layers smoothly
      for (const [cityName, layerInfo] of currentAlertLayers) {
        alertLayer.removeLayer(layerInfo.layer);
      }
      currentAlertLayers.clear();
      
      currentCenterLayers.forEach(layer => alertLayer.removeLayer(layer));
      currentCenterLayers.length = 0;
      
      statusEl.innerHTML = `
        <div class="status-bar quiet">
          <div class="pulse green"></div>
          אין התרעות פעילות
        </div>`;
      
      let listHtml = '';
      if (favoriteCities.length > 0) {
        listHtml += '<div class="favorites-section"><div class="favorites-header"><span>⭐ ערים מועדפות</span><span>' + favoriteCities.length + '</span></div>';
        for (const favCity of favoriteCities) {
          listHtml += `<div class="fav-city" onclick="viewCityHistory('${favCity.replace(/'/g, "\\'")}')">
            <span class="fav-star active" role="button" tabindex="0" aria-label="הסר ממועדפים ${favCity}" onclick="event.stopPropagation(); toggleFavorite('${favCity.replace(/'/g, "\\'")}')">⭐</span>
            <span class="fav-city-name">${favCity}</span>
            <span class="fav-status safe">Safe</span>
          </div>`;
        }
        listHtml += '</div>';
      }
      contentEl.innerHTML = listHtml;
    }
    
    if (orangeAlertTimestamps.size > 0) {
      if (!countdownInterval) {
        setCountdownInterval(setInterval(updateCountdownTimers, 1000));
      }
    } else {
      if (countdownInterval) {
        clearInterval(countdownInterval);
        setCountdownInterval(null);
      }
    }
    
  } catch (err) {
    console.error('Refresh error:', err);
    document.getElementById('status').innerHTML = `
      <div class="status-bar" style="background:rgba(239,68,68,0.1);color:#f87171;border:1px solid rgba(239,68,68,0.2);">
        שגיאת חיבור — ודא שהשרת פועל (npm start)
      </div>`;
  }
}

export function updateCountdownTimers() {
  const now = Date.now();
  
  document.querySelectorAll('.arrival-countdown[data-city]').forEach(el => {
    const cityName = el.getAttribute('data-city');
    const orangeStartTime = orangeAlertTimestamps.get(cityName);
    if (!orangeStartTime) return;
    
    let estArrival = parseFloat(el.getAttribute('data-est-arrival'));
    if (!estArrival) return;
    
    const elapsedMinutes = (now - orangeStartTime) / 60000;
    const remainingMinutes = Math.max(0, estArrival - elapsedMinutes);
    const minutes = Math.floor(remainingMinutes);
    const seconds = Math.floor((remainingMinutes - minutes) * 60);
    const timeStr = minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${seconds}s`;
    
    el.textContent = `⏱~${timeStr}`;
  });
  
  // Update wave timer (using ML estimated arrival time)
  document.querySelectorAll('.wave-timer[data-remaining][data-start-time]').forEach(el => {
    const initialRemaining = parseFloat(el.getAttribute('data-remaining'));
    const startTime = parseFloat(el.getAttribute('data-start-time'));
    
    if (initialRemaining == null || !startTime) return;
    
    // Calculate remaining time based on actual elapsed time from orange alert
    const elapsedMinutes = (now - startTime) / 60000;
    const avgEstimatedMinutes = initialRemaining + elapsedMinutes; // Reconstruct original estimate
    const remaining = Math.max(0, avgEstimatedMinutes - elapsedMinutes);
    
    if (remaining < 0.02) { // Less than ~1 second
      el.innerHTML = '<span style="color:#ef4444;font-weight:bold">צפויה כעת</span>';
    } else if (remaining < 1) {
      const secs = Math.round(remaining * 60);
      el.textContent = `~${secs} שניות`;
      el.style.color = '#ef4444';
    } else {
      const mins = Math.floor(remaining);
      const secs = Math.round((remaining - mins) * 60);
      el.textContent = `~${mins}:${secs.toString().padStart(2, '0')} דקות`;
      el.style.color = remaining < 2 ? '#ef4444' : remaining < 5 ? '#f97316' : '#fb923c';
    }
  });
}

export function startCountdown() {
  setCountdown(5);
  updateCountdownDisplay();
  if (refreshTimer) clearInterval(refreshTimer);
  setRefreshTimer(setInterval(() => {
    let c = countdown - 1;
    setCountdown(c);
    if (c <= 0) { 
      refreshAlerts(); 
      setCountdown(5);
    }
    updateCountdownDisplay();
  }, 1000));
}

function updateCountdownDisplay() {
  document.getElementById('refresh-info').textContent =
    `Refreshing in ${countdown}s • ${new Date().toLocaleTimeString('he-IL')}`;
}

// Listen for favorites changes to trigger refresh
window.addEventListener('favoritesChanged', (e) => {
  refreshAlerts();
  if (selectedCity === e.detail.cityName) {
    selectCity(selectedCity);
  }
});
