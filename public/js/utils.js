// Utility Functions
// NOTE: haversineKm, centroid, and distToProb are intentionally duplicated here
// from lib/utils/geo.js because the frontend uses ES modules without a bundler,
// and cannot import server-side CommonJS modules directly.

import { PROB_CURVE } from './config.js';

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function centroid(coordsList) {
  if (coordsList.length === 0) return null;
  const sum = coordsList.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]);
  return [sum[0] / coordsList.length, sum[1] / coordsList.length];
}

export function distToProb(distKm) {
  if (distKm <= PROB_CURVE[0].dist) return PROB_CURVE[0].prob;
  if (distKm >= PROB_CURVE[PROB_CURVE.length - 1].dist) return PROB_CURVE[PROB_CURVE.length - 1].prob;
  for (let i = 0; i < PROB_CURVE.length - 1; i++) {
    const a = PROB_CURVE[i], b = PROB_CURVE[i + 1];
    if (distKm >= a.dist && distKm <= b.dist) {
      const t = (distKm - a.dist) / (b.dist - a.dist);
      return a.prob + t * (b.prob - a.prob);
    }
  }
  return 0;
}

export function probToClass(prob) {
  if (prob >= 70) return 'high';
  if (prob >= 30) return 'med';
  if (prob >= 5) return 'low';
  return 'none';
}

export function probToColor(prob) {
  if (prob >= 70) return { color: '#ea580c', fill: '#ea580c', opacity: 0.38 + prob / 250 };
  if (prob >= 30) return { color: '#f97316', fill: '#f97316', opacity: 0.22 + prob / 350 };
  if (prob >= 5) return { color: '#fbbf24', fill: '#fbbf24', opacity: 0.12 + prob / 600 };
  return { color: '#888', fill: '#888', opacity: 0.06 };
}

export function probLabel(prob) {
  if (prob >= 90) return 'כמעט ודאי';
  if (prob >= 70) return 'סיכוי גבוה';
  if (prob >= 40) return 'ייתכן';
  if (prob >= 10) return 'סיכוי נמוך';
  return 'כמעט אפס';
}

export function getTitleSeverity(title) {
  if (!title) return 'red';
  if (title.includes('האירוע הסתיים') || title.includes('ניתן לצאת')) return 'green';
  if (title.includes('בדקות הקרובות')) return 'orange';
  return 'red';
}

export function isAlertOrange(desc) { 
  return desc && desc.includes('בדקות הקרובות'); 
}

export function isAlertRed(desc) { 
  return desc && desc.includes('ירי רקטות וטילים') && !desc.includes('האירוע הסתיים'); 
}

export function isAlertGreen(desc) { 
  return desc && (desc.includes('האירוע הסתיים') || desc.includes('ניתן לצאת')); 
}
