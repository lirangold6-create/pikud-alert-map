/**
 * Wave detection and processing utilities
 * 
 * Groups alerts into "waves" based on temporal proximity (20-minute gap).
 * Used by collector and trainer to structure alert data.
 */

const { isOrange, isRed, isGreen } = require('./alerts');

const WAVE_GAP_MS = 20 * 60 * 1000;

function buildWaves(alerts, waveGapMs = WAVE_GAP_MS) {
  const parsed = alerts
    .map(a => ({
      ...a,
      time: new Date(a.alertDate.replace(' ', 'T')).getTime()
    }))
    .filter(a => !isNaN(a.time))
    .sort((a, b) => a.time - b.time);

  if (parsed.length === 0) return [];

  const result = [];
  let current = [parsed[0]];

  for (let i = 1; i < parsed.length; i++) {
    const timeSinceLastAlert = parsed[i].time - parsed[i - 1].time;
    
    if (timeSinceLastAlert > waveGapMs) {
      result.push(processWave(current));
      current = [];
    }
    current.push(parsed[i]);
  }

  if (current.length > 0) {
    result.push(processWave(current));
  }

  return result;
}

function processWave(alerts) {
  const cityMap = {};

  for (const alert of alerts) {
    const cityName = alert.data;
    
    if (!cityMap[cityName]) {
      cityMap[cityName] = {
        orange: false,
        red: false,
        green: false,
        times: {}
      };
    }

    const entry = cityMap[cityName];
    const title = alert.title || alert.category_desc || '';

    if (isOrange(title)) {
      entry.orange = true;
      if (!entry.times.orange) {
        entry.times.orange = alert.alertDate;
      }
    }

    if (isRed(title)) {
      entry.red = true;
      if (!entry.times.red) {
        entry.times.red = alert.alertDate;
      }
    }

    if (isGreen(title)) {
      entry.green = true;
      if (!entry.times.green) {
        entry.times.green = alert.alertDate;
      }
    }
  }

  const warnedCities = Object.keys(cityMap).filter(
    c => cityMap[c].orange || cityMap[c].green
  );
  const redCities = Object.keys(cityMap).filter(c => cityMap[c].red);

  return {
    id: `wave_${alerts[0].time}`,
    startTime: alerts[0].alertDate,
    endTime: alerts[alerts.length - 1].alertDate,
    alertCount: alerts.length,
    cities: cityMap,
    summary: {
      warned: warnedCities.length,
      red: redCities.length,
      conversionRate: warnedCities.length > 0 
        ? (redCities.length / warnedCities.length) 
        : 0,
      hasGreen: Object.values(cityMap).some(c => c.green)
    }
  };
}

function isWaveComplete(wave, minWarnedCities = 5) {
  return wave.summary.hasGreen && wave.summary.warned >= minWarnedCities;
}

module.exports = {
  WAVE_GAP_MS,
  buildWaves,
  processWave,
  isWaveComplete
};
