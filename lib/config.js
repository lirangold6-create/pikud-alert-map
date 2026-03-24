/**
 * Centralized configuration
 * 
 * All constants and configuration values in one place.
 * Can be extended to load from environment variables.
 */

module.exports = {
  // Server
  PORT: parseInt(process.env.PORT) || 3000,

  // External APIs
  OREF_ALERTS_URL: 'https://www.oref.org.il/warningMessages/alert/Alerts.json',
  OREF_HISTORY_URL: 'https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json',
  OREF_FULL_HISTORY_URL: 'https://alerts-history.oref.org.il/Shared/Ajax/GetAlarmsHistory.aspx?lang=he',
  TZEVAADOM_URL: 'https://api.tzevaadom.co.il/alerts-history',

  // HTTP Headers
  OREF_HEADERS: {
    'Referer': 'https://www.oref.org.il/',
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  },

  OREF_HISTORY_HEADERS: {
    'Referer': 'https://alerts-history.oref.org.il/12481-he/Pakar.aspx',
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  },

  // Collector Settings
  POLL_INTERVAL: parseInt(process.env.POLL_INTERVAL) || 30000,
  WAVE_GAP_MS: parseInt(process.env.WAVE_GAP_MS) || (20 * 60 * 1000),
  MIN_WAVE_CITIES: parseInt(process.env.MIN_WAVE_CITIES) || 5,

  // Caching
  HISTORY_CACHE_MS: parseInt(process.env.HISTORY_CACHE_MS) || 30000,

  // ML Training Hyperparameters
  EPOCHS: parseInt(process.env.EPOCHS) || 80,
  BATCH_SIZE: parseInt(process.env.BATCH_SIZE) || 64,
  LEARNING_RATE: parseFloat(process.env.LEARNING_RATE) || 0.001,
  VALIDATION_SPLIT: parseFloat(process.env.VALIDATION_SPLIT) || 0.2,
  DROPOUT_RATE: parseFloat(process.env.DROPOUT_RATE) || 0.3,
  L2_REGULARIZATION: parseFloat(process.env.L2_REGULARIZATION) || 0.001,

  // ML Feature Configuration
  // REMOVED: green_zone_count, dist_to_nearest_green, green_within_15km
  // Reason: Data leakage - green cities mark areas already hit, inflating predictions
  FEATURE_NAMES: [
    'dist_to_center',
    'bearing_sin',
    'bearing_cos',
    // REMOVED: 'orange_zone_size' - not predictive, caused extrapolation issues
    'city_lat',
    'city_lng',
    'center_lat',
    'center_lng',
    'countdown',
    'hour_sin',
    'hour_cos',
    'city_historical_red_rate',
    'warning_delay_minutes',
    'city_avg_orange_to_red_minutes',
    // Multi-missile spatial gap features (wave-level)
    'multi_missile_detected',      // 0/1 - are there 2+ separated clusters?
    'cluster_separation_km',       // Distance between cluster centers (0 if single)
    'gap_orange_percentage',       // % of oranges in gap zone between clusters
    'city_in_minority_cluster'     // 0/1 - is this city in smaller cluster?
  ],

  // Distance-based probability curve (fallback)
  // Recalibrated from 30,921 samples across 135 completed waves (March 17, 2026)
  PROB_CURVE: [
    { dist: 0, prob: 85 },    // 595 samples, actual: 86.1%
    { dist: 5, prob: 83 },    // 1,374 samples, actual: 83.5%
    { dist: 10, prob: 80 },   // 2,038 samples, actual: 79.8%
    { dist: 15, prob: 68 },   // 2,507 samples, actual: 68.4%
    { dist: 20, prob: 57 },   // 2,867 samples, actual: 56.6%
    { dist: 25, prob: 44 },   // 2,958 samples, actual: 43.5%
    { dist: 30, prob: 36 },   // 2,781 samples, actual: 35.8%
    { dist: 35, prob: 27 },   // 2,562 samples, actual: 26.7%
    { dist: 40, prob: 25 },   // 2,368 samples, actual: 24.7%
    { dist: 50, prob: 22 },   // 1,611 samples, actual: 22.3%
    { dist: 60, prob: 25 },   // 1,052 samples, actual: 25.6%
    { dist: 70, prob: 19 },   // 601 samples, actual: 19.5%
    { dist: 80, prob: 20 },   // 449 samples, actual: 22.5%
    { dist: 100, prob: 30 }   // 271 samples, actual: 29.9% (long-range threat)
  ],

  // Model Versioning
  MAX_MODEL_HISTORY: parseInt(process.env.MAX_MODEL_HISTORY) || 5,

  // File Paths (relative to project root)
  PATHS: {
    CITIES: 'pikud-haoref-api/cities.json',
    POLYGONS: 'pikud-haoref-api/polygons.json',
    COLLECTED_ALERTS: 'data/collected-alerts.json',
    COLLECTED_WAVES: 'data/collected-waves.json',
    COLLECTED_TZEVAADOM: 'data/collected-tzevaadom.json',
    TRAINING_DATA: 'data/training-data.json',
    MODEL_DIR: 'model',
    MODEL_JSON: 'model/model.json',
    MODEL_WEIGHTS: 'model/weights.bin',
    METRICS: 'model/metrics.json',
    NORMALIZATION: 'model/normalization.json',
    CITY_DELAYS: 'model/city-delays.json',
    CITY_RATES: 'model/city-historical-rates.json'
  }
};
