# Pikud HaOref Live Alert Map with ML Prediction System

## 🎯 Project Overview

A real-time alert monitoring system for Pikud HaOref (Israeli Home Front Command) that uses machine learning to predict which cities receiving orange warning alerts will subsequently receive red rocket alerts. The system continuously learns from each event to improve prediction accuracy.

### Key Features
- **Live Alert Map**: Real-time visualization of red (rocket), orange (warning), and green (all-clear) alerts
- **ML-Powered Predictions**: 87.9% accurate predictions of orange→red conversion probability
- **Automatic Learning**: Model retrains after each completed alert wave
- **Favorites System**: Star cities you care about to track them at the top
- **Historical Analysis**: View city-specific alert history with conversion rates
- **Leaderboards**: Track which cities receive the most alerts

---

## 📁 File Structure

```
pikud/
├── server.js              # Node.js HTTP server (API + static files)
├── collector.js           # Background data collector + auto-retraining
├── train-model.js         # TensorFlow.js ML training pipeline
├── index.html             # Frontend (map + UI)
├── package.json           # Dependencies
├── collected-alerts.json  # Raw alert data (persisted)
├── collected-waves.json   # Processed alert waves (persisted)
├── model/                 # Trained ML model directory
│   ├── model.json         # TensorFlow.js model
│   ├── weights.bin        # Model weights
│   ├── metrics.json       # Training metrics + alpha blend factor
│   └── normalization.json # Feature scaling parameters
└── pikud-haoref-api/      # Submodule: city metadata + polygons
    ├── cities.json        # City data (name, zone, lat/lng, countdown)
    └── polygons.json      # City boundary polygons
```

---

## 🏗️ Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     Data Collection                          │
└─────────────────────────────────────────────────────────────┘
    │
    │ Every 30s, collector.js polls:
    ├─► Oref AlertsHistory.json (rolling 50-min window)
    ├─► Oref GetAlarmsHistory.aspx (full history API)
    └─► Tzevaadom API (red alert events)
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│              collected-alerts.json (raw storage)             │
│  { "timestamp|city|title": { alertDate, data, title, ... }}  │
└─────────────────────────────────────────────────────────────┘
    │
    │ Automatic wave detection (20-min gap between events)
    ▼
┌─────────────────────────────────────────────────────────────┐
│            collected-waves.json (processed waves)            │
│  [{ id, startTime, endTime, cities: {city: {orange, red,    │
│      green, times}}, summary: {warned, red, hasGreen} }]    │
└─────────────────────────────────────────────────────────────┘
    │
    │ When new completed wave detected (hasGreen + warned≥5)
    ▼
┌─────────────────────────────────────────────────────────────┐
│           train-model.js (auto-triggered retrain)            │
│  • Extract features from completed waves                     │
│  • Train neural network (80 epochs)                          │
│  • Compute blend alpha based on accuracy + data volume       │
│  • Save model + metrics                                      │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│              server.js (watches model/ directory)            │
│  Auto-reloads model when files change                        │
└─────────────────────────────────────────────────────────────┘
    │
    │ Real-time predictions
    ▼
┌─────────────────────────────────────────────────────────────┐
│  index.html (frontend) - Every 5s refresh cycle             │
│  • Fetches live alerts                                       │
│  • Calls /api/predict for orange cities                      │
│  • Displays blended ML + distance-based probabilities        │
└─────────────────────────────────────────────────────────────┘
```

---

## 🤖 Machine Learning System

### Model Architecture

**Type**: Feedforward Neural Network (Binary Classifier)

**Input**: 12 features per city in warning zone
- `dist_to_center`: Distance from predicted impact center (km)
- `bearing_sin`, `bearing_cos`: Direction to center (encoded as sin/cos)
- `orange_zone_size`: Number of cities in warning zone
- `city_lat`, `city_lng`: City coordinates
- `center_lat`, `center_lng`: Impact center coordinates
- `countdown`: Time to reach shelter (seconds)
- `hour_sin`, `hour_cos`: Time of day (encoded as sin/cos)
- `city_historical_red_rate`: Historical conversion rate for this city

**Architecture**:
```
Input (12 features)
    ↓
Dense (32 units, ReLU) + Dropout (0.3)
    ↓
Dense (16 units, ReLU)
    ↓
Dense (1 unit, Sigmoid) → Probability [0-1]
```

**Training**:
- 80 epochs
- Batch size: 64
- Learning rate: 0.001
- Optimizer: Adam
- Loss: Binary crossentropy with class weights
- Validation split: 20%

**Current Performance** (as of March 9, 2026):
- Validation Accuracy: **87.9%**
- Precision: **83.6%** (when predicting red, correct 83.6% of time)
- Recall: **88.2%** (catches 88.2% of actual red alerts)
- F1 Score: **85.8%**
- Trained on: **63 completed waves**, **4,157 samples**

### Prediction Blending Strategy

The system uses a **weighted blend** of ML predictions and a static distance-based curve:

```javascript
final_probability = alpha × ML_prediction + (1 - alpha) × distance_curve_prediction
```

**Alpha Calculation** (dynamic confidence factor):
- `alpha = 0.0` → 100% distance curve (no ML)
- `alpha = 0.7` → 70% ML, 30% distance curve (current)
- `alpha = 0.85` → 85% ML, 15% distance curve (max)

**Alpha Rules**:
- Starts at 0 with insufficient data
- Increases based on:
  - Number of completed waves (more data = higher alpha)
  - Validation accuracy (better model = higher alpha)
- Capped at 0.85 to maintain geographic baseline
- Current: **0.70** (70% ML, 30% distance curve)

**Distance Curve Fallback**:
```
Distance (km)  → Probability (%)
0-15          → 100%
17            → 90%
20            → 70%
25            → 39%
30            → 20%
40            → 10%
50            → 4%
60+           → 1-0%
```

### Auto-Retraining System

**Trigger Conditions**:
1. New wave completes (green "event ended" alerts received)
2. Wave has ≥5 warned cities
3. Alert count changed since last check

**Process**:
1. `collector.js` detects new completed wave
2. Executes `train-model.js` as child process
3. Training takes ~15 seconds
4. `server.js` auto-reloads new model via file watcher
5. Next prediction uses updated model

**Retraining Frequency**: After every qualifying event (typically 1-10 times per day during active periods)

---

## 🌐 API Endpoints

### Server (server.js)

All endpoints serve from `http://localhost:3000`

#### `GET /api/alerts`
**Purpose**: Fetch current active alerts  
**Response**: 
```json
{
  "active": true,
  "alerts": ["city1", "city2", ...]
}
```

#### `GET /api/history`
**Purpose**: Recent alerts (rolling 50-min window)  
**Response**: Array of alert objects

#### `GET /api/cities`
**Purpose**: City metadata  
**Source**: `pikud-haoref-api/cities.json`  
**Response**: 
```json
[
  {
    "id": 123,
    "name": "תל אביב - מרכז העיר",
    "name_en": "Tel Aviv - Center",
    "zone": "דן",
    "lat": 32.0853,
    "lng": 34.7818,
    "countdown": 90
  },
  ...
]
```

#### `GET /api/polygons`
**Purpose**: City boundary polygons for map visualization  
**Source**: `pikud-haoref-api/polygons.json`

#### `GET /api/predict?cities=...&centerLat=...&centerLng=...&zoneSize=...`
**Purpose**: Get ML predictions for orange alert cities  
**Parameters**:
- `cities`: Comma-separated city names
- `centerLat`, `centerLng`: Estimated impact center coordinates
- `zoneSize`: Number of cities in warning zone

**Response**:
```json
{
  "predictions": {
    "רעננה": {
      "prob": 73,        // Blended probability
      "ml": 78,          // ML model prediction
      "dist": 65,        // Distance-based prediction
      "source": "blended"
    },
    ...
  },
  "model": {
    "alpha": 0.7,
    "accuracy": 0.879,
    "wavesUsed": 63,
    "trainedAt": "2026-03-09T15:03:39.048Z"
  }
}
```

#### `GET /api/model-info`
**Purpose**: Current ML model status  
**Response**:
```json
{
  "loaded": true,
  "alpha": 0.7,
  "accuracy": 0.879,
  "wavesUsed": 63,
  "trainedAt": "2026-03-09T15:03:39.048Z"
}
```

#### `GET /api/full-history?mode=3&city=...`
**Purpose**: Full historical data for specific city  
**Parameters**:
- `mode`: 1 (day), 3 (month)
- `city`: City name (URL encoded)

#### `GET /api/collected?city=...&days=...`
**Purpose**: Query local collected data  
**Parameters**:
- `city`: Filter by city name (optional)
- `days`: Time window (default: 30)

#### `GET /api/leaderboard?type=red&days=7`
**Purpose**: Top 50 cities by alert count  
**Parameters**:
- `type`: `red` or `orange`
- `days`: Time window (1, 3, 7, 30)

**Response**:
```json
{
  "leaderboard": [
    { "city": "תל אביב - מרכז העיר", "count": 39 },
    { "city": "אור יהודה", "count": 37 },
    ...
  ],
  "type": "red",
  "days": 7
}
```

---

## 🎨 Frontend Design (index.html)

### Layout

```
┌────────────────────────────────────────┐
│  Map (Leaflet.js) - Full viewport     │
│                                        │
│  ┌─────────────────────────────────┐  │
│  │ Panel (right side, fixed)       │  │
│  │ ┌─────────────────────────────┐ │  │
│  │ │ Header: "מפת התרעות חיות"  │ │  │
│  │ └─────────────────────────────┘ │  │
│  │ ┌─────────────────────────────┐ │  │
│  │ │ Tabs: [Live|History|Board]  │ │  │
│  │ └─────────────────────────────┘ │  │
│  │ ┌─────────────────────────────┐ │  │
│  │ │ Tab Content (scrollable)    │ │  │
│  │ │                             │ │  │
│  │ │ [Content varies by tab]     │ │  │
│  │ │                             │ │  │
│  │ └─────────────────────────────┘ │  │
│  └─────────────────────────────────┘  │
└────────────────────────────────────────┘
```

### Three Main Tabs

#### 1. **התרעות חיות (Live Alerts)**
- **Top Section**: Status bar showing active red/orange/green alerts
- **Favorites Section**: Starred cities with current status (⭐ 67% סיכוי)
- **Red Alerts**: Cities under rocket fire (red background, pulsing dot)
- **Orange Alerts**: Cities with warnings + ML probability predictions
  - Sorted by probability (highest risk first)
  - Color-coded by risk: Red (70%+), Orange (30-70%), Yellow (<30%)
  - Shows distance from impact center
  - Displays model source (ML blended or distance curve)
- **Green Alerts**: Cities where event ended
- **Auto-refresh**: Every 5 seconds
- **Map Behavior**: Auto-fits to show all alerts (unless user manually moved map)

#### 2. **היסטוריה (History)**
- **City Search**: Dropdown with all cities (favorites marked with ⭐)
- **Time Window Selector**: 24 hours, 3 days, week, month
- **Selected City Info**: 
  - City name with star toggle
  - Zone and countdown info
  - Clear selection button
- **Conversion Analysis Card**:
  - "סיכוי שאחרי אזהרה (כתום) -> תגיע אזעקה (אדום)"
  - Shows percentage + wave count (e.g., "34% (23/68 גלים)")
  - False scare rate
  - Color-coded (red >70%, orange 40-70%, green <40%)
- **Statistics Grid**: 4 cards showing red/orange/waves/total
- **Daily Trend Chart**: Bar chart of conversion rates per day
- **Category Breakdown**: Alert types with counts
- **Timeline**: Chronological list of all alerts (up to 150 shown)

#### 3. **טבלת מובילים (Leaderboard)**
- **Filter Controls**:
  - Alert type toggle: אזעקות (אדום) / אזהרות (כתום)
  - Time window: 24 hours, 3 days, week, month
- **Leaderboard List**:
  - Top 50 cities ranked by alert count
  - Rank, city name (with star), zone, count
  - Gold/silver/bronze styling for top 3
  - Click any city to view its history
- **Summary Header**: Total alerts + city count

### Color Scheme

**Background**: Dark theme (rgba(10,10,10,0.92))

**Alert Colors**:
- Red (Rockets): `#ef4444` (rgba(239,68,68,...))
- Orange (Warning): `#f97316` (rgba(249,115,22,...))
- Green (Ended): `#22c55e` (rgba(34,197,94,...))

**Probability Colors**:
- High (70%+): Red `#f87171`
- Medium (30-70%): Orange `#fb923c`
- Low (10-30%): Yellow `#eab308`
- None (<10%): Gray `#888`

**UI Elements**:
- Active tab: `rgba(255,255,255,0.15)`
- Inactive elements: `#666` → `#888` (hover)
- Borders: `rgba(255,255,255,0.08)`
- ML indicator: Indigo `#818cf8`

### Favorites System

**Storage**: `localStorage` (key: `favoriteCities`, value: JSON array)

**How to Use**:
1. Click star (☆) next to any city → turns gold (⭐)
2. City appears in "ערים מועדפות" section at top of live alerts
3. Shows current status (safe, orange with %, red with 🚨)
4. Star persists across page refreshes

**Where Stars Appear**:
- Live alerts (all three alert types)
- History tab (selected city header, city search dropdown)
- Leaderboard (every city in the list)

### Map Interactions

**Auto-Positioning**:
- Initially: Auto-fits to show all active alerts
- After user drags/zooms: Map stays where user positioned it
- Reset: Refresh page or select a city in history

**Polygon Colors**:
- Red alerts: Solid red, high opacity
- Orange alerts: Color-coded by probability (red→orange→yellow)
- Green alerts: Green, low opacity

**Markers**:
- Red zone center: White dot (when orange alerts present)
- Distance rings: 15km, 30km, 50km (dashed white circles)
- Cities without polygons: Colored circle markers

**Popups**:
- Click any polygon/marker to see city info
- Orange cities show: City name, probability %, distance, ML source

---

## 🔧 How to Make Common Changes

### 1. Adjust Refresh Interval

**File**: `index.html`  
**Location**: Line ~401 (variables) and ~1227 (startCountdown function)

```javascript
let refreshTimer = null, countdown = 5;  // Change 5 to desired seconds

function startCountdown() {
  countdown = 5;  // Change 5 to match above
  // ...
  if (countdown <= 0) { refreshAlerts(); countdown = 5; }  // And here
}
```

### 2. Change Minimum Cities for Wave Detection

**File**: `collector.js`  
**Locations**: Lines ~197 and ~232

```javascript
// In triggerRetrain():
const completedWaves = waves.filter(w => w.summary.hasGreen && w.summary.warned >= 5);

// In poll():
const completedWaves = waves.filter(w => w.summary.hasGreen && w.summary.warned >= 5);
```

**File**: `train-model.js`  
**Location**: Line ~294

```javascript
const completedWaves = waves.filter(w => w.summary.hasGreen && w.summary.warned > 5);
```

### 3. Modify ML Model Architecture

**File**: `train-model.js`  
**Function**: `createModel()` (around line ~160)

```javascript
function createModel() {
  const model = tf.sequential();
  
  // Change these values:
  model.add(tf.layers.dense({ units: 32, activation: 'relu', inputShape: [12] }));  // Layer 1 units
  model.add(tf.layers.dropout({ rate: 0.3 }));  // Dropout rate
  model.add(tf.layers.dense({ units: 16, activation: 'relu' }));  // Layer 2 units
  model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));
  
  return model;
}
```

### 4. Adjust Training Hyperparameters

**File**: `train-model.js`  
**Location**: Lines ~15-17

```javascript
const EPOCHS = 80;           // Number of training iterations
const BATCH_SIZE = 64;        // Samples per batch
const LEARNING_RATE = 0.001;  // Optimizer learning rate
```

### 5. Change Alpha Blending Logic

**File**: `train-model.js`  
**Location**: Lines ~409-421 (inside main function)

```javascript
let alpha = 0;
if (waveCount >= 10 && fullMetrics.accuracy >= 0.90) {
  alpha = 0.85;  // Max alpha when high accuracy
} else if (waveCount >= 10 && fullMetrics.accuracy >= 0.80) {
  alpha = 0.70;  // Current typical alpha
} else if (waveCount >= 3) {
  alpha = Math.min(0.3 + (fullMetrics.accuracy - 0.5) * 0.8, 0.6);
  alpha = Math.max(alpha, 0.2);
} else {
  alpha = Math.min(waveCount / 5, 0.3) * fullMetrics.accuracy;
}
alpha = Math.max(0, Math.min(0.85, alpha));  // Clamp [0, 0.85]
```

### 6. Modify Distance-Based Probability Curve

**File**: `server.js`  
**Location**: Lines ~94-99

```javascript
const PROB_CURVE = [
  { dist: 0, prob: 100 },   // 0km = 100%
  { dist: 5, prob: 100 },
  { dist: 15, prob: 100 },
  { dist: 20, prob: 70 },   // 20km = 70%
  { dist: 30, prob: 20 },   // 30km = 20%
  { dist: 50, prob: 4 },
  { dist: 80, prob: 0 },
];
```

**Same in**: `index.html` (lines ~495-502)

### 7. Change Polling Interval (Data Collection)

**File**: `collector.js`  
**Location**: Line ~26

```javascript
const POLL_INTERVAL = 30000;  // Change to desired milliseconds (30000 = 30s)
```

### 8. Modify Wave Gap Duration

**File**: `collector.js`  
**Location**: Line ~27

```javascript
const WAVE_GAP_MS = 20 * 60 * 1000;  // 20 minutes in ms
```

Change `20` to desired minutes. Smaller gap = more waves, larger gap = fewer but longer waves.

### 9. Add New Features to ML Model

**File**: `train-model.js`

**Step 1**: Add feature name to `FEATURE_NAMES` (line ~19)
```javascript
const FEATURE_NAMES = [
  'dist_to_center',
  // ... existing features ...
  'your_new_feature'  // Add here
];
```

**Step 2**: Add feature calculation in `extractFeatures()` (around line ~140)
```javascript
samples.push({
  features: [
    dist,
    Math.sin(bear),
    // ... existing features ...
    yourNewFeatureValue  // Add calculation here
  ],
  label: gotRed,
  meta: { city: cityName, wave: wave.id, dist }
});
```

**Step 3**: Update `createModel()` input shape if needed (line ~161)
```javascript
inputShape: [13]  // Change from 12 to match new feature count
```

### 10. Change Panel Size/Position

**File**: `index.html`  
**Location**: Lines ~17-23

```javascript
#panel {
  position: absolute; 
  top: 12px;        // Distance from top
  right: 12px;      // Distance from right (change to 'left' for left side)
  width: 360px;     // Panel width
  max-height: calc(100vh - 24px);  // Max height
}
```

---

## 🚀 Running the System

### Initial Setup

```bash
cd /Users/liran.goldstein/Cursor-hubs/pikud

# Install dependencies
npm install

# Ensure TensorFlow is installed
npm list @tensorflow/tfjs-node
```

### Starting Components

**Option 1: Manual (separate terminals)**
```bash
# Terminal 1: Start server
node server.js

# Terminal 2: Start collector
node collector.js

# Terminal 3: Manual training (optional)
node train-model.js
```

**Option 2: Using npm scripts**
```bash
npm run serve    # Start server
npm run collect  # Start collector
npm run train    # Run training
```

### Accessing the Application

Open browser: `http://localhost:3000`

### Monitoring

**Server Logs**: Shows API requests and model reload events
```
[ML] Model loaded (alpha=0.70, waves=63, val_acc=87.9%)
Live alert map running at http://localhost:3000
```

**Collector Logs**: Shows data collection and retraining
```
Alert collector started (oref + tzevaadom)
  Oref alerts: 12803
  Waves: 98
  Polling every 30s

[15:43:57] oref: +660 (total: 12803)
  [waves] 98 waves, 63 completed (warned→green)
  [waves] Latest: 697 warned, 239 red (34.3%)
  [retrain] Triggering retrain with 63 completed waves...
  [retrain] Success!
```

---

## 📊 Data Files Details

### collected-alerts.json
**Format**: Object with keys as `alertDate|city|title`
```json
{
  "2026-03-09 15:43:57|רעננה|בדקות הקרובות צפויות להתקבל התרעות באזורך": {
    "alertDate": "2026-03-09 15:43:57",
    "title": "בדקות הקרובות צפויות להתקבל התרעות באזורך",
    "data": "רעננה",
    "category": 1,
    "category_desc": "בדקות הקרובות צפויות להתקבל התרעות באזורך"
  }
}
```

**Alert Types** (by title/category_desc):
- Orange: "בדקות הקרובות צפויות להתקבל התרעות באזורך"
- Red: "ירי רקטות וטילים"
- Green: "האירוע הסתיים" or "ניתן לצאת מהמרחב המוגן"

### collected-waves.json
**Format**: Array of wave objects
```json
[
  {
    "id": "wave_1709992437000",
    "startTime": "2026-03-09 15:43:57",
    "endTime": "2026-03-09 17:02:21",
    "alertCount": 1625,
    "cities": {
      "רעננה": {
        "orange": true,
        "red": true,
        "green": true,
        "times": {
          "orange": "2026-03-09 15:43:57",
          "red": "2026-03-09 15:45:32",
          "green": "2026-03-09 16:02:14"
        }
      }
    },
    "summary": {
      "warned": 697,
      "red": 239,
      "conversionRate": 0.343,
      "hasGreen": true
    }
  }
]
```

**Wave Completion Criteria**:
- `hasGreen: true` (green alerts received)
- `warned >= 5` (minimum cities in warning zone)

### model/metrics.json
```json
{
  "trainedAt": "2026-03-09T15:03:39.048Z",
  "wavesUsed": 63,
  "totalSamples": 4157,
  "positiveRate": 0.457,
  "validation": {
    "accuracy": 0.879,
    "precision": 0.836,
    "recall": 0.882,
    "f1": 0.858,
    "tp": 305,
    "fp": 60,
    "tn": 426,
    "fn": 41
  },
  "full": { /* same metrics for full dataset */ },
  "alpha": 0.7,
  "bestValAcc": 0.883,
  "bestEpoch": 76
}
```

---

## 🐛 Troubleshooting

### Model Not Loading
**Symptom**: "[ML] TensorFlow.js not available"  
**Cause**: Missing `@tensorflow/tfjs-node`  
**Fix**: 
```bash
npm install
# Verify installation
ls -la node_modules/@tensorflow/tfjs-node
```

### Auto-Retraining Fails
**Symptom**: Collector logs show "Failed: Cannot find module"  
**Cause**: TensorFlow not in PATH for child process  
**Fix**: Ensure npm modules are properly installed, restart collector

### Predictions Not Updating
**Symptom**: Old probabilities after new event  
**Check**:
1. Is collector running? `ps aux | grep collector.js`
2. Are waves being detected? Check `collected-waves.json` modification time
3. Did retraining succeed? Look for "[retrain] Success!" in collector logs
4. Did server reload model? Look for "[ML] Model files changed, reloading..." in server logs

### Map Not Auto-Centering
**Symptom**: Map doesn't show new alerts  
**Cause**: User manually moved/zoomed the map  
**Behavior**: This is intentional! Map stays where user positioned it  
**Reset**: Refresh page or click a city in history tab

### High Memory Usage
**Symptom**: Node process using lots of RAM  
**Cause**: Large `collected-alerts.json` file (10k+ alerts)  
**Solutions**:
- Archive old data periodically
- Increase Node.js memory: `node --max-old-space-size=4096 server.js`
- Consider database migration for production

---

## 🔮 Future Enhancements

### Potential Improvements

1. **Multi-Model Ensemble**
   - Train separate models for different times of day
   - Separate models for different regions
   - Combine predictions with weighted voting

2. **Additional Features**
   - Weather data (wind direction affects interception)
   - Missile trajectory predictions
   - Historical attack patterns by source location
   - Iron Dome coverage zones

3. **Real-Time Updates**
   - WebSocket connection instead of polling
   - Push notifications for high-probability cities
   - Mobile app integration

4. **Advanced Visualizations**
   - Heat maps of historical danger zones
   - 3D trajectory visualizations
   - Animated wave progression replay

5. **Database Migration**
   - Move from JSON files to PostgreSQL/MongoDB
   - Enable complex queries and analytics
   - Improve performance for large datasets

6. **API Rate Limiting**
   - Implement proper caching headers
   - Add rate limiting for public access
   - CDN for static assets

---

## 📝 Notes for New Developers

### Key Design Decisions

1. **Why JSON Files Instead of Database?**
   - Quick prototyping and easy debugging
   - No external dependencies for initial development
   - Direct file inspection without DB tools
   - Consider migrating for production use

2. **Why Blend ML + Distance Curve?**
   - Early in development, limited training data
   - Geographic distance is highly predictive
   - Provides graceful degradation if ML fails
   - Gradually increases ML influence as confidence grows

3. **Why 20-Minute Wave Gap?**
   - Balances grouping related events vs. separating distinct events
   - Tested empirically with historical data
   - Captures orange→red→green sequence in single wave

4. **Why Auto-Retrain After Each Wave?**
   - Rapidly adapt to changing attack patterns
   - Fresh data is most relevant for next event
   - Minimal latency (~15s) acceptable for learning
   - Continuous improvement without manual intervention

5. **Why Client-Side Rendering?**
   - Real-time updates without page reload
   - Responsive UI with local state management
   - Reduces server load (only API calls)
   - Easy to iterate on frontend without backend changes

### Code Style Guidelines

- **ES6+ JavaScript**: Use modern syntax (arrow functions, async/await, destructuring)
- **Hebrew Comments**: Use Hebrew for domain-specific terms (alert types, UI labels)
- **English Comments**: Use English for technical logic and architecture
- **Error Handling**: Always wrap external API calls in try/catch
- **Logging**: Use descriptive logs with timestamps and context

### Testing Approach

**Current State**: No formal test suite (prototyping phase)

**Manual Testing**:
1. Run during active alert periods
2. Compare ML predictions to actual outcomes
3. Monitor accuracy in `model/metrics.json`
4. Spot-check predictions in browser console

**Recommended Tests** (for production):
- Unit tests for feature extraction logic
- Integration tests for data collection
- End-to-end tests for prediction pipeline
- UI tests for critical user flows

---

## 🤝 Contributing

### Making Changes

1. **Test locally** with `node server.js` + `node collector.js`
2. **Monitor collector logs** during active events
3. **Check model metrics** after retraining
4. **Validate UI** in browser at `localhost:3000`
5. **Update this README** for significant changes

### Git Workflow (when adding version control)

```bash
# Create feature branch
git checkout -b feature/your-feature-name

# Make changes, test thoroughly

# Commit with descriptive message
git commit -m "feat: add X feature to improve Y"

# Push and create PR
git push origin feature/your-feature-name
```

---

## 📜 License & Disclaimer

**Disclaimer**: This is an educational project for learning ML and real-time data processing. Not affiliated with or endorsed by Pikud HaOref. For official alerts, always refer to the official Pikud HaOref app and sirens.

**Data Sources**:
- Pikud HaOref public APIs
- Tzevaadom.co.il public API
- City metadata from pikud-haoref-api package

---

## 📞 Support

For questions or issues, review:
1. This README
2. Collector logs: `collector.log` or terminal output
3. Server logs: Terminal running `server.js`
4. Browser console: Check for JavaScript errors
5. Model metrics: `cat model/metrics.json`

---

**Last Updated**: March 9, 2026  
**Project Status**: Active Development  
**Current Model**: v1.0, 87.9% validation accuracy, 63 waves
