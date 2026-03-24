// Main Entry Point

import { initMap } from './map.js';
import { loadStaticData, loadHistory } from './api.js';
import { refreshAlerts, startCountdown } from './alerts.js';
import { initTabs } from './tabs.js';
import { initHistoryTab } from './history.js';
import { initLeaderboard } from './leaderboard.js';

(async () => {
  initMap();
  initTabs();
  initHistoryTab();
  initLeaderboard();
  
  await loadStaticData();
  await Promise.all([refreshAlerts(), loadHistory()]);
  startCountdown();

  window.refreshAlerts = refreshAlerts;
})();
