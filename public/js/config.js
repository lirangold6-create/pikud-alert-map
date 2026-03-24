// Configuration and Constants

export const SEVERITY_STYLES = {
  red:    { color: '#ef4444', fill: '#ef4444', fillOpacity: 0.35 },
  orange: { color: '#f97316', fill: '#f97316', fillOpacity: 0.25 },
  green:  { color: '#22c55e', fill: '#22c55e', fillOpacity: 0.20 },
};

export const CLUSTER_COLORS = ['#ef4444', '#8b5cf6', '#06b6d4'];
export const CLUSTER_NAMES = ['ראשון', 'שני', 'שלישי'];

export function getThreatLevel(avgProb) {
  if (avgProb >= 70) return { label: 'גבוה', color: '#ef4444' };
  if (avgProb >= 40) return { label: 'בינוני', color: '#f97316' };
  return { label: 'נמוך', color: '#fb923c' };
}

export function formatRemainingTime(estimatesWithTime, elapsedMinutes) {
  if (!estimatesWithTime || estimatesWithTime.length === 0) return { display: 'לא ידוע', remaining: null };
  const avg = estimatesWithTime.reduce((sum, c) => sum + c.estimatedArrivalMinutes, 0) / estimatesWithTime.length;
  const remaining = Math.max(0, avg - elapsedMinutes);
  if (remaining < 1) return { display: '<span style="color:#ef4444;font-weight:bold">צפויה כעת</span>', remaining };
  const mins = Math.floor(remaining);
  const secs = Math.round((remaining - mins) * 60);
  const display = mins > 0 ? `~${mins}:${secs.toString().padStart(2, '0')} דקות` : `~${secs} שניות`;
  return { display, remaining };
}

// Client-side fallback curve, used ONLY when the /api/predict endpoint is unreachable.
// The authoritative curve lives in lib/config.js (server), calibrated from 30k+ samples.
// This simpler version intentionally differs: it's more aggressive at close range
// (100% up to 15 km) to keep the UI conservative when the ML backend is unavailable.
export const PROB_CURVE = [
  { dist: 0,   prob: 100 },
  { dist: 5,   prob: 100 },
  { dist: 10,  prob: 100 },
  { dist: 15,  prob: 100 },
  { dist: 17,  prob: 90 },
  { dist: 20,  prob: 70 },
  { dist: 25,  prob: 39 },
  { dist: 30,  prob: 20 },
  { dist: 40,  prob: 10 },
  { dist: 50,  prob: 4 },
  { dist: 60,  prob: 1 },
  { dist: 80,  prob: 0 },
];
