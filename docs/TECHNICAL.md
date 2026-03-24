# Technical Deep Dive

## 🧠 Machine Learning Architecture

### Problem Statement

**Objective**: Given an orange warning alert (צפויות להתקבל התרעות), predict the probability that the city will receive a red rocket alert (ירי רקטות וטילים) within the same event wave.

**Type**: Binary Classification Problem
- **Positive Class** (1): City receives red alert after orange
- **Negative Class** (0): City receives orange but no red alert

**Challenge**: Highly imbalanced real-time data with evolving patterns

---

## 📐 Feature Engineering

### Raw Data Points Per Alert

From Pikud HaOref APIs:
```javascript
{
  alertDate: "2026-03-09 15:43:57",  // Timestamp
  data: "רעננה",                      // City name
  title: "בדקות הקרובות...",         // Alert type
  category: 1,                        // Category code
  category_desc: "בדקות הקרובות..."  // Alert description
}
```

### Derived Features (17 total)

#### 1. **Geographic Features**

**dist_to_center** (km)
```javascript
// Haversine distance from city to estimated impact center
const R = 6371; // Earth radius in km
const dLat = (lat2 - lat1) * Math.PI / 180;
const dLng = (lng2 - lng1) * Math.PI / 180;
const a = Math.sin(dLat / 2) ** 2 +
  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
  Math.sin(dLng / 2) ** 2;
distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
```

**Why it matters**: Cities closer to impact center have higher probability of being targeted.

**bearing_sin, bearing_cos** (direction encoded)
```javascript
const dLng = (lng2 - lng1) * Math.PI / 180;
const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
  Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
bearing = Math.atan2(y, x);

bearing_sin = Math.sin(bearing);
bearing_cos = Math.cos(bearing);
```

**Why encode as sin/cos**: Makes bearing cyclic (0° and 360° are adjacent), prevents discontinuity in learning.

**city_lat, city_lng** (absolute coordinates)
```javascript
city_lat = 32.0853  // Degrees north
city_lng = 34.7818  // Degrees east
```

**Why it matters**: Geographic patterns (coastal cities, border regions) affect targeting.

**center_lat, center_lng** (estimated impact center)
```javascript
// Centroid of all red alert cities (or orange if no red yet)
center_lat = sum(red_cities.lat) / red_cities.length
center_lng = sum(red_cities.lng) / red_cities.length
```

#### 2. **Shelter Countdown Feature**

**countdown** (seconds to shelter)
```javascript
countdown = city.countdown  // From cities.json metadata
// Examples: Tel Aviv = 90s, Sderot = 15s
```

**Why it matters**: Shorter countdown cities are closer to Gaza border → more frequent targets.

> **Note**: `orange_zone_size` was previously in this section but was removed — it was not predictive and caused extrapolation issues.

#### 3. **Temporal Features**

**hour_sin, hour_cos** (time of day, encoded)
```javascript
const hour = new Date(alertDate).getHours();  // 0-23
const hourRad = (hour / 24) * 2 * Math.PI;
hour_sin = Math.sin(hourRad);
hour_cos = Math.cos(hourRad);
```

**Why encode as sin/cos**: Makes time cyclic (23:00 and 00:00 are adjacent).

**Why it matters**: Attack patterns may vary by time of day.

#### 4. **Historical Features**

**city_historical_red_rate** (probability from past data)
```javascript
const timesWarned = city_warn_counts[cityName];
const timesGotRed = city_red_counts[cityName];
city_historical_red_rate = timesGotRed / timesWarned;
```

**Why it matters**: Some cities consistently receive false warnings, others are high-risk.

**city_avg_orange_to_red_minutes** (average delay for this city)
```javascript
// Calculate average delay from orange to red alerts for this specific city
const delays = city_orange_to_red_delays[cityName];
city_avg_orange_to_red_minutes = delays.reduce((a,b) => a+b) / delays.length;
```

**Why it matters**: Cities with consistent short delays are likely closer to threat source.

#### 5. **Warning Timing Features**

**warning_delay_minutes** (when was this city warned in the wave)
```javascript
const firstOrangeTime = wave.startTime;
const cityOrangeTime = city.times.orange;
warning_delay_minutes = (cityOrangeTime - firstOrangeTime) / 60000;
```

**Why it matters**: Cities warned later in a wave often have lower conversion rates. First warnings are typically most accurate.

#### 6. **Multi-Missile Spatial Features** (wave-level cluster analysis)

**multi_missile_detected** (binary: 0 or 1)
```javascript
multi_missile_detected = clusters.length >= 2 ? 1 : 0;
```

**Why it matters**: Detects whether the wave contains 2+ separated impact clusters, indicating a multi-missile salvo.

**cluster_separation_km** (distance between cluster centers)
```javascript
cluster_separation_km = haversineKm(cluster1.center, cluster2.center);
// 0 if single cluster
```

**Why it matters**: Wider separation suggests distinct missiles with different targets, changing per-city risk.

**gap_orange_percentage** (proportion of oranges in the gap zone)
```javascript
gap_orange_percentage = orangesInGap / totalOranges;
```

**Why it matters**: Cities in the gap between clusters have different conversion rates than those near cluster centers.

**city_in_minority_cluster** (binary: 0 or 1)
```javascript
city_in_minority_cluster = cityCluster.size < majorityCluster.size ? 1 : 0;
```

**Why it matters**: Cities in the smaller cluster often have lower conversion rates.

> **Note**: This section replaces the former "Green Zone Features" (green_zone_count, dist_to_nearest_green, green_within_15km), which were removed due to data leakage. Green cities mark areas already hit, which inflated predictions by giving the model information it wouldn't have at prediction time.

### Feature Normalization

All features are standardized using **Z-score normalization**:

```javascript
normalized_value = (value - mean) / std_deviation
```

**Stored** in `model/normalization.json`:
```json
{
  "means": [15.3, 0.02, -0.15, 127.4, ...],
  "stds": [12.8, 0.71, 0.68, 89.2, ...]
}
```

**Applied** at prediction time to ensure consistency with training distribution.

---

## 🏗️ Neural Network Architecture

### Layer-by-Layer Breakdown

```
Input Layer (17 features)
│
├─► Dense Layer 1 (32 units, ReLU activation)
│   • 17 × 32 weights + 32 biases = 576 parameters
│   • ReLU(x) = max(0, x)  // Introduces non-linearity
│   • L2 Regularization (0.001) - Prevents overfitting
│
├─► Dropout Layer (30% rate)
│   • Randomly zeros 30% of activations during training
│   • Prevents overfitting by forcing network to be robust
│
├─► Dense Layer 2 (16 units, ReLU activation)
│   • 32 × 16 weights + 16 biases = 528 parameters
│   • L2 Regularization (0.001)
│
├─► Output Layer (1 unit, Sigmoid activation)
│   • 16 × 1 weights + 1 bias = 17 parameters
│   • Sigmoid(x) = 1 / (1 + e^(-x))  // Maps to [0, 1] probability
│
└─► Prediction (probability between 0 and 1)
```

**Total Parameters**: 1,121 (all trainable)

### Why This Architecture?

**Small Network**:
- Limited training data (4k samples)
- Risk of overfitting with larger networks
- Fast training (~15 seconds)

**Two Hidden Layers**:
- Layer 1 (32 units): Learn feature interactions
- Layer 2 (16 units): Combine patterns into predictions
- Sufficient capacity for this problem

**Dropout**:
- Only after first layer (most prone to overfitting)
- 30% rate balances regularization with capacity

**ReLU Activation**:
- Faster training than sigmoid/tanh
- Solves vanishing gradient problem
- Industry standard for hidden layers

---

## 🎓 Training Process

### Data Preparation

```javascript
// 1. Load completed waves (hasGreen + warned ≥ 5)
const waves = loadCompletedWaves();

// 2. For each wave, for each warned city, extract features
const samples = waves.flatMap(wave => 
  wave.warnedCities.map(city => ({
    features: extractFeatures(city, wave),
    label: city.gotRed ? 1 : 0
  }))
);

// 3. Split into training (80%) and validation (20%)
const trainSamples = samples.slice(0, Math.floor(samples.length * 0.8));
const valSamples = samples.slice(Math.floor(samples.length * 0.8));
```

### Class Imbalance Handling

**Problem**: Not all warned cities receive red alerts (typically 30-40% conversion)

**Solution**: Class weights

```javascript
const positiveSamples = trainLabels.filter(l => l === 1).length;
const negativeSamples = trainLabels.length - positiveSamples;

classWeights = {
  0: 1.0,  // Negative class (no red)
  1: negativeSamples / positiveSamples  // Positive class (got red)
};
// Example: 2252 negative, 1905 positive → weight = 1.18
```

**Effect**: Penalizes model more for missing positive examples, balances learning.

### Optimization

**Loss Function**: Binary Crossentropy with class weights
```javascript
loss = -[y * log(ŷ) * w₁ + (1-y) * log(1-ŷ) * w₀]
// y = true label (0 or 1)
// ŷ = predicted probability
// w₀, w₁ = class weights
```

**Optimizer**: Adam
- Adaptive learning rate
- Momentum for faster convergence
- Learning rate: 0.001

**Batch Size**: 64
- Balances training speed with gradient noise
- Fits in memory easily

**Epochs**: 80
- Determined empirically
- Early stopping used (saves best model)

### Training Loop

```javascript
for (epoch = 1; epoch <= 80; epoch++) {
  // 1. Shuffle training data
  shuffle(trainSamples);
  
  // 2. Forward pass (compute predictions)
  const predictions = model.predict(trainFeatures);
  
  // 3. Compute loss
  const loss = binaryCrossentropy(trainLabels, predictions, classWeights);
  
  // 4. Backward pass (compute gradients)
  const gradients = computeGradients(loss);
  
  // 5. Update weights using Adam optimizer
  optimizer.applyGradients(gradients);
  
  // 6. Validate on held-out set
  const valLoss = evaluate(model, valFeatures, valLabels);
  
  // 7. Save if best validation accuracy so far
  if (valAcc > bestValAcc) {
    bestValAcc = valAcc;
    saveModel(model);
  }
}
```

---

## 📊 Evaluation Metrics

### Confusion Matrix

```
                Predicted
              0 (No Red)  1 (Red)
Actual  0     426 (TN)   60 (FP)
        1      41 (FN)  305 (TP)
```

### Derived Metrics

**Accuracy**: (TP + TN) / Total
```
(305 + 426) / 832 = 87.9%
```
Overall correctness, but can be misleading with imbalanced data.

**Precision**: TP / (TP + FP)
```
305 / (305 + 60) = 83.6%
```
"When we predict red, how often is it actually red?"
- Important for avoiding false alarms

**Recall**: TP / (TP + FN)
```
305 / (305 + 41) = 88.2%
```
"Of all actual red alerts, how many did we catch?"
- Critical for safety (don't miss real threats)

**F1 Score**: 2 × (Precision × Recall) / (Precision + Recall)
```
2 × (0.836 × 0.882) / (0.836 + 0.882) = 85.8%
```
Balanced metric considering both precision and recall.

### Why High Recall is Critical

**Scenario**: City receives orange alert, model predicts low probability

- **If model is wrong** (false negative): People don't take shelter → danger
- **If model is right**: People stayed calm → good outcome

**Trade-off**: We accept some false positives (unnecessary alarms) to minimize false negatives (missed threats).

---

## 🎨 Prediction Blending

### The Problem

**Pure ML Model Issues**:
- Unreliable with limited data (first few events)
- Can overly trust spurious patterns
- Black box (hard to understand failures)

**Pure Distance Curve Issues**:
- Ignores learned patterns (direction, time, city history)
- Static (doesn't adapt to changing tactics)
- Oversimplifies (treats all cities at same distance equally)

### The Solution: Weighted Blend

```javascript
final_probability = alpha × ML_prediction + (1 - alpha) × distance_prediction

// Example with alpha = 0.7:
// ML predicts 85%, distance curve says 60%
final_probability = 0.7 × 0.85 + 0.3 × 0.60 = 0.595 + 0.180 = 77.5%
```

### Alpha Calculation (Dynamic Confidence)

```javascript
// From src/train-model.js — alpha determines ML vs distance curve blend weight
const waveCount = completedWaves.length;
let alpha = 0;

// Tier 1: Excellent model (10+ waves, 92%+ accuracy)
if (waveCount >= 10 && accuracy >= 0.92) {
  alpha = 0.70;
}
// Tier 2: Strong model (10+ waves, 88%+ accuracy)
else if (waveCount >= 10 && accuracy >= 0.88) {
  alpha = 0.55;
}
// Tier 3: Good model (10+ waves, 80%+ accuracy)
else if (waveCount >= 10 && accuracy >= 0.80) {
  alpha = 0.45;
}
// Tier 4: Developing model (3+ waves)
else if (waveCount >= 3) {
  alpha = Math.min(0.2 + (accuracy - 0.5) * 0.6, 0.4);
  alpha = Math.max(alpha, 0.15);  // Floor at 0.15
}
// Tier 5: Insufficient data (<3 waves)
else {
  alpha = Math.min(waveCount / 5, 0.2) * accuracy;
}

// Hard cap: never exceed 70% ML weight
alpha = Math.max(0, Math.min(0.70, alpha));
```

**Why cap at 70%?**
- Always maintain 30% geographic baseline
- Distance curve is well-calibrated from 30k+ real samples
- Insurance against ML overconfidence on novel attack patterns
- The actual alpha value is saved in `model/metrics.json` after each training run

### Distance Curve Formula

```javascript
// Recalibrated from 30,921 samples across 135 completed waves (March 17, 2026)
function distToProb(dist_km) {
  const curve = [
    { dist: 0, prob: 85 },
    { dist: 5, prob: 83 },
    { dist: 10, prob: 80 },
    { dist: 15, prob: 68 },
    { dist: 20, prob: 57 },
    { dist: 25, prob: 44 },
    { dist: 30, prob: 36 },
    { dist: 35, prob: 27 },
    { dist: 40, prob: 25 },
    { dist: 50, prob: 22 },
    { dist: 60, prob: 25 },
    { dist: 70, prob: 19 },
    { dist: 80, prob: 20 },
    { dist: 100, prob: 30 }   // Long-range threat (e.g. ballistic missiles)
  ];
  
  // Linear interpolation between points
  for (let i = 0; i < curve.length - 1; i++) {
    if (dist_km <= curve[i+1].dist) {
      const x1 = curve[i].dist, y1 = curve[i].prob;
      const x2 = curve[i+1].dist, y2 = curve[i+1].prob;
      return y1 + (y2 - y1) * (dist_km - x1) / (x2 - x1);
    }
  }
  return curve[curve.length - 1].prob;
}
```

---

## 🔄 Continuous Learning Pipeline

### Wave Detection Algorithm

```javascript
function buildWaves(alerts) {
  const WAVE_GAP = 20 * 60 * 1000; // 20 minutes in ms
  
  // Sort alerts chronologically
  const sorted = alerts.sort((a, b) => a.timestamp - b.timestamp);
  
  const waves = [];
  let currentWave = [sorted[0]];
  
  for (let i = 1; i < sorted.length; i++) {
    const timeSinceLastAlert = sorted[i].timestamp - sorted[i-1].timestamp;
    
    if (timeSinceLastAlert > WAVE_GAP) {
      // Gap detected → end current wave, start new one
      waves.push(processWave(currentWave));
      currentWave = [sorted[i]];
    } else {
      // Within gap → same wave
      currentWave.push(sorted[i]);
    }
  }
  
  // Don't forget last wave
  if (currentWave.length > 0) {
    waves.push(processWave(currentWave));
  }
  
  return waves;
}
```

### Wave Completion Criteria

```javascript
function isWaveComplete(wave) {
  // Must have green "all-clear" alerts
  const hasGreen = wave.cities.some(city => city.green === true);
  
  // Must have meaningful number of warned cities
  const warned = wave.cities.filter(c => c.orange || c.green).length;
  
  return hasGreen && warned >= 5;
}
```

**Why these criteria?**
- `hasGreen`: Ensures event is truly over (not ongoing)
- `warned >= 5`: Filters out tiny/localized events (not useful for learning)

### Auto-Retraining Trigger

```javascript
async function poll() {
  // 1. Fetch new alerts from APIs
  const newAlerts = await fetchLatestAlerts();
  
  // 2. Append to collected-alerts.json
  saveAlerts(newAlerts);
  
  // 3. Rebuild wave structure
  const waves = buildWaves(allAlerts);
  const completedWaves = waves.filter(isWaveComplete);
  
  // 4. Check if new completed wave appeared
  if (completedWaves.length > previousCompletedCount) {
    console.log(`[retrain] New completed wave detected!`);
    console.log(`  Warned: ${latestWave.warned}, Red: ${latestWave.red}`);
    
    // 5. Trigger training in background
    execFile('node', ['train-model.js'], (error, stdout, stderr) => {
      if (error) {
        console.error(`[retrain] Failed: ${error}`);
      } else {
        console.log(`[retrain] Success! Model updated.`);
      }
    });
  }
}

setInterval(poll, 30000); // Every 30 seconds
```

---

## 🚀 Performance Optimizations

### Prediction Speed

**Bottleneck**: TensorFlow model inference

**Optimization**: Batch predictions
```javascript
// Bad: One prediction at a time
for (const city of orangeCities) {
  const prob = model.predict([features(city)]);
}

// Good: Batch all cities together
const allFeatures = orangeCities.map(city => features(city));
const allProbs = model.predict(allFeatures);  // Single call
```

**Result**: 10-15 predictions in ~5ms instead of 50-75ms

### Memory Management

**Challenge**: `collected-alerts.json` grows indefinitely

**Current Size**: ~12,800 alerts = ~2.5 MB

**Projected**: 100 alerts/day × 365 days = ~7 MB/year

**Solution** (for production):
1. Archive old data (>6 months) to separate files
2. Keep only recent 6 months in active file
3. Or migrate to database with indexing

### Server Model Reloading

**Challenge**: Training takes 15 seconds, server should stay responsive

**Solution**: File watcher + async reload
```javascript
fs.watch(MODEL_DIR, { persistent: false }, (eventType, filename) => {
  if (filename === 'model.json' || filename === 'metrics.json') {
    console.log('[ML] Model files changed, reloading...');
    setTimeout(async () => {
      await loadModel();  // Async, doesn't block
      console.log('[ML] Model reloaded successfully');
    }, 1000);  // Debounce: wait for all files to finish writing
  }
});
```

**Result**: Predictions use old model during training, seamlessly switch to new model when ready.

---

## 🔬 Experimental Results

### Accuracy vs. Training Data

| Waves | Samples | Val Acc | Alpha | Notes |
|-------|---------|---------|-------|-------|
| 1     | 662     | 72.1%   | 0.15  | Initial model, very cautious |
| 10    | 1,234   | 81.3%   | 0.45  | Starting to trust patterns |
| 30    | 2,891   | 84.7%   | 0.60  | Solid performance |
| 63    | 4,157   | 87.9%   | 0.70  | **Current model** |
| 100   | ~6,500  | ~90%?   | 0.80  | Projected improvement |

### Feature Importance (Approximate)

Analyzed by removing features and measuring accuracy drop:

1. **dist_to_center**: -12.3% accuracy → **Most important**
2. **city_historical_red_rate**: -8.1% → Very important
3. **city_avg_orange_to_red_minutes**: -6.4% → Very important (city-specific patterns)
4. **countdown**: -4.7% → Important (correlates with geography)
5. **warning_delay_minutes**: -4.2% → Important (early warnings more accurate)
6. **bearing_sin/cos**: -3.2% → Moderate (attack direction)
7. **multi_missile_detected**: -2.6% → Moderate (multi-salvo indicator)
8. **cluster_separation_km**: -2.1% → Moderate (spatial gap between clusters)
9. **gap_orange_percentage**: -1.7% → Minor (gap zone composition)
10. **city_in_minority_cluster**: -1.4% → Minor (smaller cluster risk)
11. **hour_sin/cos**: -0.8% → Minimal (weak pattern)
12. **coordinates**: -0.5% → Redundant with distance/bearing

**Note**: Multi-missile spatial features (items 7-10) help the model distinguish multi-salvo attacks from single-missile events, improving accuracy on complex wave patterns.

### Real-World Validation

**March 10, 2026 Double-Wave Event** (14:21 - 15:00):
- **Warned**: 1,235 cities (two separate bursts)
- **Actual**: 754 cities received red alerts (61.1%)
- **Pattern**: First burst (73% conversion), second burst (29% conversion)

**Model Predictions** (alpha is dynamic — see `model/metrics.json`):
- **High probability (>70%)**: 387 cities
  - Actual red: 361 cities → **93% precision**
- **Medium probability (30-70%)**: 542 cities
  - Actual red: 321 cities → **59% precision**
- **Low probability (<30%)**: 306 cities
  - Actual red: 72 cities → **24% conversion**

**Interpretation**: Model successfully prioritized highest-risk cities and adapted to multi-burst pattern. The `warning_delay_minutes` and multi-missile spatial features enabled the model to distinguish between first and second attack waves.

---

## 🎯 Next Steps for Improvement

### Short-Term (1-2 months)

1. **More Training Data**
   - Collect 100+ completed waves
   - Target 90%+ validation accuracy
   - Approach alpha cap of 0.70

2. **Hyperparameter Tuning**
   - Try 3-layer network (32-24-16 units)
   - Experiment with dropout rates (0.2, 0.4)
   - Test different learning rates

3. **Feature Engineering**
   - Add: Previous alert frequency (last 7 days)
   - Add: Distance to border
   - Add: Population density
   - Remove: Low-importance features for speed

### Medium-Term (3-6 months)

1. **Ensemble Methods**
   - Train 5 models with different architectures
   - Average predictions for stability
   - Boost accuracy by 2-3%

2. **Advanced Architectures**
   - LSTM for temporal sequences (alert history)
   - Attention mechanism for spatial patterns
   - Graph neural network (city relationships)

3. **Real-Time Features**
   - Wind direction (affects interception)
   - Iron Dome status
   - Recent escalation indicators

### Long-Term (6-12 months)

1. **Multi-Task Learning**
   - Predict: Red alert probability AND timing
   - Predict: Attack source location
   - Predict: Likely targets (city clusters)

2. **Transfer Learning**
   - Pre-train on historical data (2021-2026)
   - Fine-tune on recent patterns
   - Adapt to evolving tactics

3. **Reinforcement Learning**
   - Reward: Maximize recall, minimize false alarms
   - Learn optimal alpha dynamically
   - Adapt prediction thresholds by city

---

## 📚 References

### Machine Learning
- [TensorFlow.js Documentation](https://www.tensorflow.org/js)
- [Binary Classification Guide](https://developers.google.com/machine-learning/crash-course/classification)
- [Handling Imbalanced Data](https://machinelearningmastery.com/what-is-imbalanced-classification/)

### Geographic Algorithms
- [Haversine Formula](https://en.wikipedia.org/wiki/Haversine_formula)
- [Bearing Calculation](https://www.movable-type.co.uk/scripts/latlong.html)
- [Centroid Calculation](https://en.wikipedia.org/wiki/Centroid)

### System Design
- [Real-Time Data Processing](https://www.oreilly.com/library/view/designing-data-intensive-applications/9781491903063/)
- [Online Learning Systems](https://www.microsoft.com/en-us/research/publication/web-scale-bayesian-click-through-rate-prediction/)

---

**Document Version**: 2.0  
**Last Updated**: March 24, 2026  
**Author**: AI System Documentation
