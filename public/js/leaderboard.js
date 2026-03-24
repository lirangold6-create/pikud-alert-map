// Leaderboard Tab

import { 
  nameToCity, leaderboardType, leaderboardDays, historyDays,
  setLeaderboardType, setLeaderboardDays, setHistoryDays
} from './state.js';
import { fetchLeaderboard } from './api.js';
import { isFavorite } from './favorites.js';
import { selectCity } from './history.js';

export async function loadLeaderboard() {
  const content = document.getElementById('leaderboard-content');
  content.innerHTML = '<div class="leaderboard-loading">טוען נתונים...</div>';

  try {
    const data = await fetchLeaderboard(leaderboardType, leaderboardDays);
    renderLeaderboard(data);
  } catch (err) {
    console.error('Leaderboard error:', err);
    content.innerHTML = '<div class="leaderboard-loading">שגיאה בטעינת נתונים</div>';
  }
}

function renderLeaderboard(data) {
  const content = document.getElementById('leaderboard-content');
  
  if (!data.leaderboard || data.leaderboard.length === 0) {
    content.innerHTML = '<div class="leaderboard-loading">אין נתונים לתקופה זו</div>';
    return;
  }

  const typeLabel = leaderboardType === 'red' ? 'אזעקות (אדום)' : 'אזהרות (כתום)';
  const totalAlerts = data.leaderboard.reduce((sum, item) => sum + item.count, 0);

  let html = `
    <div class="leaderboard-header">
      <span>סה"כ ${typeLabel}: <span class="total-cities">${totalAlerts}</span></span>
      <span>${data.leaderboard.length} ערים</span>
    </div>
    <ul class="leaderboard-list">`;

  data.leaderboard.forEach((item, idx) => {
    const city = nameToCity[item.city];
    const zone = city ? city.zone : '';
    const star = isFavorite(item.city) ? '⭐' : '☆';
    const starClass = isFavorite(item.city) ? 'active' : 'inactive';
    html += `
      <li class="leaderboard-item" onclick="viewCityHistory('${item.city.replace(/'/g, "\\'")}')">
        <div class="lb-rank">${idx + 1}</div>
        <div class="lb-city-info">
          <div class="lb-city-name">
            <span class="fav-star ${starClass}" onclick="event.stopPropagation(); toggleFavorite('${item.city.replace(/'/g, "\\'")}');">${star}</span>
            ${item.city}
          </div>
          ${zone ? `<div class="lb-city-zone">${zone}</div>` : ''}
        </div>
        <div class="lb-count ${leaderboardType}">${item.count}</div>
      </li>`;
  });

  html += '</ul>';
  content.innerHTML = html;
}

export function viewCityHistory(cityName) {
  setHistoryDays(leaderboardDays);
  document.querySelectorAll('.time-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.days) === historyDays);
  });

  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelector('[data-tab="history"]').classList.add('active');
  document.getElementById('tab-history').classList.add('active');
  
  const searchInput = document.getElementById('city-search');
  searchInput.value = cityName;
  selectCity(cityName);
}

export function initLeaderboard() {
  document.querySelectorAll('.type-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setLeaderboardType(btn.dataset.type);
      if (btn.dataset.type === 'orange') {
        btn.style.background = 'rgba(249,115,22,0.15)';
        btn.style.color = '#fb923c';
      } else {
        btn.style.background = 'rgba(239,68,68,0.15)';
        btn.style.color = '#f87171';
      }
      loadLeaderboard();
    });
  });

  document.querySelectorAll('.lb-time-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lb-time-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setLeaderboardDays(parseInt(btn.dataset.days));
      loadLeaderboard();
    });
  });
}

// Make functions globally accessible for onclick handlers
window.viewCityHistory = viewCityHistory;
