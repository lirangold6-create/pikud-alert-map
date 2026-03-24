// Tab Switching Logic

import { fullHistory } from './state.js';
import { loadHistory } from './api.js';
import { loadLeaderboard } from './leaderboard.js';

export function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
      if (tab.dataset.tab === 'history' && fullHistory.length === 0) loadHistory();
      if (tab.dataset.tab === 'leaderboard') loadLeaderboard();
    });
  });
}
