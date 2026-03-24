/**
 * Feature Engineering - Single Source of Truth
 * 
 * This file defines ALL features used by the ML model.
 * ANY change to features MUST be made here and will automatically
 * propagate to training, inference, and validation code.
 */

const { haversineKm, bearingRad } = require('../utils/geo');

/**
 * Feature definitions with metadata
 */
const FEATURE_DEFINITIONS = [
  { name: 'dist_to_center', type: 'continuous', description: 'Distance from city to attack center (km)' },
  { name: 'bearing_sin', type: 'continuous', description: 'Sin of bearing angle from center to city' },
  { name: 'bearing_cos', type: 'continuous', description: 'Cos of bearing angle from center to city' },
  { name: 'city_lat', type: 'continuous', description: 'City latitude' },
  { name: 'city_lng', type: 'continuous', description: 'City longitude' },
  { name: 'center_lat', type: 'continuous', description: 'Attack center latitude' },
  { name: 'center_lng', type: 'continuous', description: 'Attack center longitude' },
  { name: 'countdown', type: 'continuous', description: 'City countdown time (seconds)' },
  { name: 'hour_sin', type: 'continuous', description: 'Sin of hour (24-hour cycle)' },
  { name: 'hour_cos', type: 'continuous', description: 'Cos of hour (24-hour cycle)' },
  { name: 'city_historical_red_rate', type: 'continuous', description: 'Historical red alert rate for this city' },
  { name: 'warning_delay_minutes', type: 'continuous', description: 'Minutes since orange alert started' },
  { name: 'city_avg_orange_to_red_minutes', type: 'continuous', description: 'Average time from orange to red for this city' },
  { name: 'multi_missile_detected', type: 'binary', description: '1 if multiple missile clusters detected, 0 otherwise' },
  { name: 'cluster_separation_km', type: 'continuous', description: 'Distance between attack clusters (0 if single missile)' },
  { name: 'gap_orange_percentage', type: 'continuous', description: 'Percentage of orange cities in gap between clusters' },
  { name: 'city_in_minority_cluster', type: 'binary', description: '1 if city is in smaller cluster, 0 otherwise' }
];

/**
 * Get ordered list of feature names
 */
function getFeatureNames() {
  return FEATURE_DEFINITIONS.map(f => f.name);
}

/**
 * Get number of features
 */
function getFeatureCount() {
  return FEATURE_DEFINITIONS.length;
}

/**
 * Extract features for a single city
 * 
 * @param {Object} params
 * @param {Object} params.city - City object with {name, lat, lng, countdown}
 * @param {Object} params.center - Center coordinates {lat, lng}
 * @param {number} params.hour - Hour of day (0-23)
 * @param {Object} params.cityRates - Map of city name -> historical red rate
 * @param {Object} params.cityDelays - Map of city name -> average orange-to-red delay
 * @param {number} params.warningDelayMinutes - Minutes since orange alert (default 0 for inference)
 * @param {Object} params.multiMissileInfo - Multi-missile detection info {detected, separation, clusters}
 * @param {Array<string>} params.orangeCities - List of all orange city names (for gap calculation)
 * @param {Object} params.nameToCity - Map of city name to city object (for gap calculation)
 * @returns {Array<number>} Feature vector
 */
function extractFeatures(params) {
  const {
    city,
    center,
    hour,
    cityRates = {},
    cityDelays = {},
    warningDelayMinutes = 0,
    multiMissileInfo = null,
    orangeCities = [],
    nameToCity = {}
  } = params;

  // Validate required params
  if (!city || !city.lat || !city.lng) {
    throw new Error('City must have lat/lng coordinates');
  }
  if (!center || !center.lat || !center.lng) {
    throw new Error('Center must have lat/lng coordinates');
  }

  // Basic geometric features
  const dist = haversineKm(city.lat, city.lng, center.lat, center.lng);
  const bear = bearingRad(center.lat, center.lng, city.lat, city.lng);
  const countdown = city.countdown || 0;

  // Temporal features
  const hourRad = (hour / 24) * 2 * Math.PI;

  // Historical features
  const histRate = cityRates[city.name] ?? 0.44; // Fallback to training mean
  const avgDelay = cityDelays[city.name] ?? 0;

  // Multi-missile features
  const multiMissileDetected = multiMissileInfo && multiMissileInfo.detected ? 1 : 0;
  const clusterSeparation = multiMissileDetected ? (multiMissileInfo.separation || 0) : 0;
  
  // Gap orange percentage
  let gapOrangePercentage = 0;
  if (multiMissileDetected && multiMissileInfo.clusters && multiMissileInfo.clusters.length >= 2) {
    const cluster1Cities = new Set(multiMissileInfo.clusters[0].cities);
    const cluster2Cities = new Set(multiMissileInfo.clusters[1].cities);
    const c1Center = multiMissileInfo.clusters[0].center;
    const c2Center = multiMissileInfo.clusters[1].center;
    
    let gapCount = 0;
    for (const oName of orangeCities) {
      const oCity = nameToCity[oName];
      if (!oCity || oCity.lat == null) continue;
      if (cluster1Cities.has(oName) || cluster2Cities.has(oName)) continue;
      
      const distToC1 = haversineKm(oCity.lat, oCity.lng, c1Center.lat, c1Center.lng);
      const distToC2 = haversineKm(oCity.lat, oCity.lng, c2Center.lat, c2Center.lng);
      if (Math.abs(distToC1 - distToC2) < 30) gapCount++;
    }
    gapOrangePercentage = orangeCities.length > 0 ? (gapCount / orangeCities.length) * 100 : 0;
  }

  // City in minority cluster
  let cityInMinorityCluster = 0;
  if (multiMissileDetected && multiMissileInfo.clusters && multiMissileInfo.clusters.length >= 2) {
    const cluster1Cities = new Set(multiMissileInfo.clusters[0].cities);
    const cluster2Cities = new Set(multiMissileInfo.clusters[1].cities);
    const cluster1Size = multiMissileInfo.clusters[0].size;
    const cluster2Size = multiMissileInfo.clusters[1].size;
    
    const inCluster1 = cluster1Cities.has(city.name);
    const inCluster2 = cluster2Cities.has(city.name);
    
    if ((inCluster1 && cluster1Size < cluster2Size) || (inCluster2 && cluster2Size < cluster1Size)) {
      cityInMinorityCluster = 1;
    }
  }

  // Return features in EXACT order defined in FEATURE_DEFINITIONS
  return [
    dist,
    Math.sin(bear),
    Math.cos(bear),
    city.lat,
    city.lng,
    center.lat,
    center.lng,
    countdown,
    Math.sin(hourRad),
    Math.cos(hourRad),
    histRate,
    warningDelayMinutes,
    avgDelay,
    multiMissileDetected,
    clusterSeparation,
    gapOrangePercentage,
    cityInMinorityCluster
  ];
}

/**
 * Validate that feature vector has correct length
 * Throws error if mismatch detected
 */
function validateFeatureVector(features, context = 'unknown') {
  const expectedCount = getFeatureCount();
  const actualCount = features.length;
  
  if (actualCount !== expectedCount) {
    throw new Error(
      `Feature mismatch in ${context}: expected ${expectedCount} features but got ${actualCount}.\n` +
      `Expected features: ${getFeatureNames().join(', ')}\n` +
      `This usually means the model was trained with different features than the code is using.\n` +
      `Solution: Retrain the model with 'npm run train'`
    );
  }
}

/**
 * Validate that normalization params match feature count
 */
function validateNormalization(norm, context = 'normalization') {
  const expectedCount = getFeatureCount();
  
  if (!norm || !norm.means || !norm.stds) {
    throw new Error(`${context}: Missing means or stds`);
  }
  
  if (norm.means.length !== expectedCount) {
    throw new Error(
      `${context}: means length mismatch. Expected ${expectedCount} but got ${norm.means.length}`
    );
  }
  
  if (norm.stds.length !== expectedCount) {
    throw new Error(
      `${context}: stds length mismatch. Expected ${expectedCount} but got ${norm.stds.length}`
    );
  }
}

/**
 * Normalize features using mean/std normalization
 */
function normalizeFeatures(features, norm) {
  validateFeatureVector(features, 'pre-normalization');
  validateNormalization(norm);
  
  return features.map((value, i) => {
    const mean = norm.means[i];
    const std = norm.stds[i];
    
    if (std === 0) {
      console.warn(`Warning: Feature ${i} (${FEATURE_DEFINITIONS[i].name}) has std=0, returning 0`);
      return 0;
    }
    
    return (value - mean) / std;
  });
}

module.exports = {
  FEATURE_DEFINITIONS,
  getFeatureNames,
  getFeatureCount,
  extractFeatures,
  validateFeatureVector,
  validateNormalization,
  normalizeFeatures
};
