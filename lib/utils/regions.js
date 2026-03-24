/**
 * Regional clustering and attack pattern recognition
 * Identifies distinct threat zones: Jerusalem/Shomron, Tel Aviv/Center, North, South
 */

const { haversineKm } = require('./geo');

// Define major threat regions with their geographic centers and radius
const THREAT_REGIONS = {
  JERUSALEM_SHOMRON: {
    name: 'Jerusalem/Shomron',
    center: { lat: 31.85, lng: 35.20 }, // Jerusalem area
    radius: 35, // km
    zones: ['ירושלים', 'יריחו', 'שומרון', 'בית שמש', 'מעלה אדומים', 'יהודה']
  },
  TEL_AVIV_CENTER: {
    name: 'Tel Aviv/Center',
    center: { lat: 32.08, lng: 34.78 }, // Tel Aviv
    radius: 30,
    zones: ['תל אביב - מרכז', 'תל אביב - דרום', 'תל אביב - צפון', 'גוש דן', 'שפלה']
  },
  NORTH: {
    name: 'North',
    center: { lat: 32.85, lng: 35.30 }, // Haifa/Galilee area
    radius: 50,
    zones: ['גליל עליון', 'גליל תחתון', 'חיפה', 'עמקים', 'גולן', 'כרמל']
  },
  SOUTH: {
    name: 'South',
    center: { lat: 31.40, lng: 34.60 }, // Gaza envelope
    radius: 40,
    zones: ['לכיש', 'שפלת יהודה', 'עוטף עזה', 'נגב צפוני', 'באר שבע', 'אשקלון', 'שדרות', 'קרית גת']
  }
};

/**
 * Cluster cities into distinct threat regions
 * @param {Array} cityNames - Array of city names
 * @param {Object} nameToCity - Map of city name to city object
 * @returns {Object} - Clusters with region assignments
 */
function clusterCitiesByRegion(cityNames, nameToCity) {
  const clusters = {
    JERUSALEM_SHOMRON: [],
    TEL_AVIV_CENTER: [],
    NORTH: [],
    SOUTH: [],
    OTHER: []
  };

  for (const cityName of cityNames) {
    const city = nameToCity[cityName];
    if (!city || !city.lat || !city.lng) continue;

    let assigned = false;

    // Try zone-based assignment first (more reliable)
    if (city.zone) {
      for (const [regionKey, region] of Object.entries(THREAT_REGIONS)) {
        if (region.zones.some(z => city.zone.includes(z) || z.includes(city.zone))) {
          clusters[regionKey].push(cityName);
          assigned = true;
          break;
        }
      }
    }

    // Fallback to distance-based assignment
    if (!assigned) {
      let closestRegion = 'OTHER';
      let minDist = Infinity;

      for (const [regionKey, region] of Object.entries(THREAT_REGIONS)) {
        const dist = haversineKm(city.lat, city.lng, region.center.lat, region.center.lng);
        if (dist < region.radius && dist < minDist) {
          minDist = dist;
          closestRegion = regionKey;
        }
      }

      clusters[closestRegion].push(cityName);
    }
  }

  return clusters;
}

/**
 * Detect primary attack region from clustered cities and wave center
 * @param {Object} clusters - Result from clusterCitiesByRegion
 * @param {Number} centerLat - Wave center latitude
 * @param {Number} centerLng - Wave center longitude
 * @returns {Object} - { primaryRegion, secondaryRegions, isFocused }
 */
function detectAttackPattern(clusters, centerLat = null, centerLng = null) {
  // Count cities in each region
  const counts = {};
  let total = 0;
  for (const [region, cities] of Object.entries(clusters)) {
    if (region !== 'OTHER') {
      counts[region] = cities.length;
      total += cities.length;
    }
  }

  // Find primary region by count
  let primaryRegion = null;
  let maxCount = 0;
  for (const [region, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      primaryRegion = region;
    }
  }

  // Use count-based primary region (don't override based on center)
  const finalConcentration = total > 0 ? maxCount / total : 0;
  
  // Identify secondary regions (>10% of total)
  const secondaryRegions = [];
  let maxSecondaryCount = 0;
  for (const [region, count] of Object.entries(counts)) {
    if (region !== primaryRegion && count > 0 && count / total >= 0.1) {
      secondaryRegions.push(region);
      maxSecondaryCount = Math.max(maxSecondaryCount, count);
    }
  }
  
  // CRITICAL: If secondary region has >20% of cities, attack is ambiguous
  // Historical data shows secondary region wins 26% of the time!
  // Don't apply strong "focused" multipliers in these cases
  const maxSecondaryPct = total > 0 ? maxSecondaryCount / total : 0;
  const hasSignificantSecondary = maxSecondaryPct >= 0.20;
  
  // Consider focused only if: high concentration AND no significant secondary region
  const isFocused = (!hasSignificantSecondary) && (
    finalConcentration >= 0.55 || (total > 50 && finalConcentration >= 0.45)
  );

  return {
    primaryRegion,
    secondaryRegions,
    isFocused,
    concentration: finalConcentration * 100,
    regionCounts: counts,
    totalCities: total,
    hasSignificantSecondary,
    maxSecondaryPct: maxSecondaryPct * 100
  };
}

/**
 * Calculate region-specific probability multiplier based on regional dominance
 * Uses continuous scaling instead of binary focused/unfocused
 * Historical data shows PT conversion: 57% in Jerusalem-dom, 82% balanced, 94% in TA-dom
 * @param {string} cityRegion - Region of the city being predicted
 * @param {Object} attackPattern - Result from detectAttackPattern
 * @returns {number} - Multiplier (0.1 to 1.2)
 */
function getRegionalProbabilityMultiplier(cityRegion, attackPattern, multiMissileInfo = null, cityName = null) {
  const { primaryRegion, concentration, regionCounts, totalCities } = attackPattern;
  
  if (multiMissileInfo && multiMissileInfo.detected && cityName) {
    const inCluster1 = multiMissileInfo.clusters[0].cities.includes(cityName);
    const inCluster2 = multiMissileInfo.clusters[1].cities.includes(cityName);
    
    if (inCluster1 || inCluster2) return 1.15;
    return 0.85;
  }
  
  // OTHER region: city doesn't fit neatly into any defined region.
  // Don't penalize — its probability should come from distance/model, not region label.
  if (cityRegion === 'OTHER') return 1.0;

  const dominance = concentration / 100;
  
  if (cityRegion === primaryRegion) {
    // Scale boost based on dominance: 1.0x (balanced) to 1.2x (highly dominant)
    // At 50% dominance: 1.0x, at 70%+ dominance: 1.2x
    if (dominance >= 0.70) return 1.2;
    if (dominance >= 0.60) return 1.15;
    if (dominance >= 0.50) return 1.1;
    return 1.0; // Low dominance - no boost
  }
  
  // ═══ Jerusalem vs Tel Aviv mutual exclusion ═══
  const isMutuallyExclusive = 
    (cityRegion === 'JERUSALEM_SHOMRON' && primaryRegion === 'TEL_AVIV_CENTER') ||
    (cityRegion === 'TEL_AVIV_CENTER' && primaryRegion === 'JERUSALEM_SHOMRON');
  
  if (isMutuallyExclusive) {
    const cityRegionCount = regionCounts[cityRegion] || 0;
    const cityPct = totalCities > 0 ? cityRegionCount / totalCities : 0;
    
    // If city's region has significant presence (15%+), it's part of the attack
    if (cityPct >= 0.15) return 0.95;
    
    // City's region has minimal presence — apply penalty based on opposite dominance
    if (dominance >= 0.70) return 0.2;
    if (dominance >= 0.55) return 0.4;
    return 0.7;
  }
  
  // Check if the city's region has meaningful presence in the attack.
  // Use BOTH percentage (for focused attacks) and absolute count (for massive attacks
  // where even 5% could be 50+ cities).
  const cityRegionCount = regionCounts[cityRegion] || 0;
  const cityRegionPct = totalCities > 0 ? cityRegionCount / totalCities : 0;

  if (cityRegionPct >= 0.15 || cityRegionCount >= 20) {
    return 0.95;
  }
  if (attackPattern.secondaryRegions && attackPattern.secondaryRegions.includes(cityRegion)) {
    return 0.85;
  }
  if (cityRegionCount >= 5) {
    return 0.75;
  }
  return 0.5;
}

/**
 * Calculate red alert feedback factor
 * Once cities turn red, remaining orange cities are less likely to be hit
 * @param {number} orangeCount - Number of cities still in orange
 * @param {number} redCount - Number of cities that turned red
 * @param {number} timeElapsed - Minutes since first orange alert
 * @returns {number} - Multiplier (0.1 to 1.0)
 */
function getRedAlertFeedbackMultiplier(orangeCount, redCount, timeElapsed) {
  if (redCount === 0) return 1.0;

  // Reds CONFIRM the attack is real and landing. More reds = higher
  // confidence that remaining orange cities will also be hit.
  const redRatio = redCount / (orangeCount + redCount);

  if (redRatio > 0.5) return 1.25;
  if (redRatio > 0.3) return 1.20;
  if (redRatio > 0.1) return 1.15;
  return 1.05;
}

/**
 * Get region for a specific city
 * @param {string} cityName - City name
 * @param {Object} nameToCity - Map of city name to city object
 * @returns {string} - Region key
 */
function getCityRegion(cityName, nameToCity) {
  const city = nameToCity[cityName];
  if (!city || !city.lat || !city.lng) return 'OTHER';

  // Try zone-based first
  if (city.zone) {
    for (const [regionKey, region] of Object.entries(THREAT_REGIONS)) {
      if (region.zones.some(z => city.zone.includes(z) || z.includes(city.zone))) {
        return regionKey;
      }
    }
  }

  // Fallback to distance-based
  let closestRegion = 'OTHER';
  let minDist = Infinity;

  for (const [regionKey, region] of Object.entries(THREAT_REGIONS)) {
    const dist = haversineKm(city.lat, city.lng, region.center.lat, region.center.lng);
    if (dist < region.radius && dist < minDist) {
      minDist = dist;
      closestRegion = regionKey;
    }
  }

  return closestRegion;
}

module.exports = {
  THREAT_REGIONS,
  clusterCitiesByRegion,
  detectAttackPattern,
  getRegionalProbabilityMultiplier,
  getRedAlertFeedbackMultiplier,
  getCityRegion
};
