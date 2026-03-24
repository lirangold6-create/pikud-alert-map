// Favorites Management

import { favoriteCities } from './state.js';

export function toggleFavorite(cityName) {
  const idx = favoriteCities.indexOf(cityName);
  if (idx > -1) {
    favoriteCities.splice(idx, 1);
  } else {
    favoriteCities.push(cityName);
  }
  localStorage.setItem('favoriteCities', JSON.stringify(favoriteCities));
  
  // Trigger refresh via custom event to avoid circular dependency
  window.dispatchEvent(new CustomEvent('favoritesChanged', { detail: { cityName } }));
}

export function isFavorite(cityName) {
  return favoriteCities.includes(cityName);
}

// Make functions globally accessible for onclick handlers
window.toggleFavorite = toggleFavorite;
