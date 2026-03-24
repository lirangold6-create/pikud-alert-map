# Pikud HaOref Live Alert Map with ML Prediction System

## 🎯 Project Overview

A real-time alert monitoring system for Pikud HaOref (Israeli Home Front Command) that uses machine learning to predict which cities receiving orange warning alerts will subsequently receive red rocket alerts. The system continuously learns from each event to improve prediction accuracy.

### Key Features
- **Live Alert Map**: Real-time visualization of red (rocket), orange (warning), and green (all-clear) alerts
- **ML-Powered Predictions**: Spatial gap awareness (v1.2); see `model/metrics.json` for current model metrics.
- **Multi-Missile Detection & UI**: Automatically detects separated missile clusters and shows:
  - **Multiple center markers** on map (color-coded per cluster)
  - **Separate countdown timers** for each missile
  - **Independent threat assessment** per cluster
  - Learns from red polygon separation pattern (27% avg gap)
- **Regional Attack Recognition**: Distinguishes Jerusalem vs Tel Aviv vs North vs South attack patterns
- **Red Alert Feedback**: Once cities turn red, probabilities for remaining cities automatically adjust
- **Automatic Learning**: Model retrains after each completed alert wave
- **Favorites System**: Star cities you care about to track them at the top
- **Historical Analysis**: View city-specific alert history with conversion rates and multi-missile markers
- **Leaderboards**: Track which cities receive the most alerts

---

## 📁 File Structure

```
pikud/
├── index.html             # Frontend entry point
├── package.json           # Dependencies & npm scripts
├── README.md              # This file
├── .env.example          # Environment template
│
├── src/                   # Source code
│   ├── server.js         # HTTP server + ML predictions
│   ├── collector.js      # Alert collector + auto-retrain
│   └── train-model.js    # ML training pipeline
│
├── scripts/               # Utility scripts
│   ├── analyze-waves.js                  # Wave analysis tool
│   ├── analyze-multi-missile-patterns.js # Multi-missile pattern analysis
│   ├── analyze-model-calibration.js      # Calibration metrics
│   ├── recalculate-probabilities.js      # Batch re-prediction
│   └── test-prediction-calibration.js    # Validation on test set
│
├── lib/                   # Shared libraries
│   ├── config.js         # Centralized configuration
│   ├── ml/               # ML utilities
│   │   ├── features.js   # Feature extraction (single source of truth)
│   │   └── validate-model.js # Model compatibility checking
│   └── utils/            # Utility modules
│       ├── geo.js        # Geographic calculations
│       ├── alerts.js     # Alert classification
│       ├── waves.js      # Wave detection
│       ├── regions.js    # Regional clustering & attack patterns
│       ├── multi-missile.js # Multi-missile detection & clustering
│       └── telegram.js   # Telegram notifications
│
├── public/                # Frontend assets
│   ├── css/
│   │   └── styles.css    # All styles
│   └── js/               # JavaScript modules (11 files)
│       ├── main.js       # Entry point
│       ├── config.js     # Constants
│       ├── state.js      # State management
│       ├── utils.js      # Utilities
│       ├── api.js        # API calls
│       ├── favorites.js  # Favorites
│       ├── map.js        # Map logic
│       ├── history.js    # History tab
│       ├── alerts.js     # Live alerts tab
│       ├── leaderboard.js # Leaderboard tab
│       └── tabs.js       # Tab switching
│
├── tests/                 # Test suite
│   └── unit/             # Unit tests (34 tests)
│
├── docs/                  # Documentation
│   ├── ARCHITECTURE.md          # System architecture
│   ├── TECHNICAL.md             # Technical deep-dive
│   ├── MULTI_MISSILE.md         # Multi-missile detection system
│   ├── FEATURE_SYSTEM.md        # Feature mismatch prevention
│   ├── MODEL_CALIBRATION_REPORT.md # Model calibration analysis
│   └── archive/                 # Historical documentation
│
├── data/                  # Generated data
│   ├── collected-alerts.json
│   ├── collected-waves.json
│   └── training-data.json
│
├── model/                 # ML model files
│   ├── model.json              # TensorFlow.js architecture
│   ├── weights.bin             # Trained parameters
│   ├── metrics.json            # Training metrics + alpha blend
│   ├── normalization.json      # Feature scaling (means/stds)
│   ├── city-delays.json        # Historical orange→red delay per city
│   └── city-historical-rates.json # Historical conversion rates per city
│
└── pikud-haoref-api/     # Static reference data
    ├── cities.json       # 1,360 cities
    └── polygons.json     # City boundaries
```

See `docs/ARCHITECTURE.md` for detailed architecture documentation.

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

**Type**: Feedforward Neural Network (Binary Classifier) with Regional Awareness & Red Alert Feedback

**Input**: 17 features per city in warning zone

**Geographic Features** (7):
- `dist_to_center`: Distance from predicted impact center (km)
- `bearing_sin`, `bearing_cos`: Direction to center (encoded as sin/cos)
- `city_lat`, `city_lng`: City coordinates
- `center_lat`, `center_lng`: Impact center coordinates

**Event Context Features** (2):
- `countdown`: Time to reach shelter (seconds)
- `warning_delay_minutes`: Time since first orange alert in wave

**Historical Features** (2):
- `city_historical_red_rate`: Historical conversion rate for this city
- `city_avg_orange_to_red_minutes`: Average delay from orange to red for this city

**Temporal Features** (2):
- `hour_sin`, `hour_cos`: Time of day (encoded as sin/cos)

**Multi-Missile Features** (4):
- `multi_missile_detected`: Whether 2+ separated missile clusters detected
- `cluster_separation_km`: Distance between detected clusters
- `gap_orange_percentage`: Percentage of orange cities in gap zone between clusters
- `city_in_minority_cluster`: Whether city belongs to the smaller cluster

**Architecture**:
```
Input (17 features)
    ↓
Dense (32 units, ReLU) + Dropout (0.3) + L2 Regularization
    ↓
Dense (16 units, ReLU) + L2 Regularization
    ↓
Dense (1 unit, Sigmoid) → Probability [0-1]
    ↓
Regional Adjustment × Red Alert Feedback → Final Probability
```

**Training**:
- 80 epochs, Batch size: 64, Learning rate: 0.001
- Optimizer: Adam
- Loss: Binary crossentropy with class weights
- Validation split: 20%

**Current Performance**: See `model/metrics.json` for current model metrics. Wave and sample counts are in `wavesUsed` and `totalSamples` there.

### Regional Attack Recognition

The system identifies four distinct threat zones:
- **Jerusalem/Shomron** (31.85°N, 35.20°E): Jerusalem, West Bank settlements
- **Tel Aviv/Center** (32.08°N, 34.78°E): Tel Aviv, Gush Dan, Sharon
- **North** (32.85°N, 35.30°E): Haifa, Galilee, Golan
- **South** (31.40°N, 34.60°E): Gaza envelope, Lachish, Ashkelon

**Mutual Exclusion**: Jerusalem and Tel Aviv are almost never targeted together. When a focused attack on one region is detected, the other receives an 85% probability reduction.

### Regional Attack Separation (80km Threshold)

When red alerts exist, the system checks whether they're from the same attack as the orange alerts by measuring the distance between their centers. If > 80km apart, they're treated as separate attacks and the orange center is used for predictions instead of the red center. This prevents a scenario where, e.g., northern reds would pull Tel Aviv orange predictions to near-zero. See `docs/REGIONAL_ATTACK_FIX.md` for details.

### Red Alert Feedback

Once cities turn red (actual rocket impacts), the model:
1. **Fixes the center** on red cities (actual impact zone)
2. **Reduces probabilities** for remaining orange cities (40-80% reduction based on conversion rate)
3. **Prevents recalculation** using leftover orange cities

### Prediction Blending Strategy

The system uses a **weighted blend** of ML predictions and a static distance-based curve:

```javascript
final_probability = alpha × ML_prediction + (1 - alpha) × distance_curve_prediction
```

**Alpha Calculation** (dynamic confidence factor):
- `alpha = 0.0` → 100% distance curve (no ML)
- Intermediate values blend ML and distance curve; see `model/metrics.json` for the live `alpha`
- `alpha = 0.85` → 85% ML, 15% distance curve (max)

**Alpha Rules**:
- Starts at 0 with insufficient data
- Increases based on:
  - Number of completed waves (more data = higher alpha)
  - Validation accuracy (better model = higher alpha)
- Capped at 0.85 to maintain geographic baseline
- Current `alpha`: see `model/metrics.json`

**Distance Curve Fallback** (calibrated from 30,921 samples across 135 completed waves, March 17, 2026):
```
Distance (km)  → Probability (%)
0             → 85%
5             → 83%
10            → 80%
15            → 68%
20            → 57%
25            → 44%
30            → 36%
35            → 27%
40            → 25%
50            → 22%
60            → 25%
70            → 19%
80            → 20%
100           → 30% (long-range threat)
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

#### `GET /api/recent-history`
**Purpose**: Merged recent alerts from Oref history + local collected data (last 30 minutes)  
**Parameters**:
- `testWave`: Set to `1` to generate synthetic test wave data

**Response**: Array of alert objects sorted by time (newest first)

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

#### `POST /api/predict`
**Purpose**: Get ML predictions for orange alert cities
**Body**: JSON with `cities`, `centerLat`, `centerLng`, `zoneSize`, optional `redCities`, `redCenter`

**Response**: Includes `predictions` per city and a `model` object (`alpha`, `accuracy`, `wavesUsed`, `trainedAt`, etc.) sourced from `model/metrics.json`.
```json
{
  "predictions": {
    "רעננה": {
      "prob": 73,        // Blended probability
      "ml": 78,          // ML model prediction
      "dist": 65,        // Distance-based prediction
      "source": "blended"
    }
  }
}
```

#### `GET /api/model-info`
**Purpose**: Current ML model status  
**Response**: JSON with `hasModel` and the same metric fields as `model/metrics.json` (see that file for current values).

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

**Files**: `public/js/alerts.js` and `public/js/state.js`

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
  model.add(tf.layers.dense({ units: 32, activation: 'relu', inputShape: [17] }));  // Layer 1 units
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

Alpha is calculated in `src/train-model.js` based on wave count and validation accuracy. The logic progressively trusts the ML model more as data accumulates and accuracy improves. See the training code for exact thresholds. Current `alpha`, wave count, and accuracy: see `model/metrics.json`.

### 6. Modify Distance-Based Probability Curve

**File**: `lib/config.js`

The distance curve is defined in `lib/config.js` as `PROB_CURVE`, calibrated from 30,921 actual samples. See the ML System section above for current values.

### 7. Change Polling Interval (Data Collection)

**File**: `lib/config.js` (`POLL_INTERVAL`) or `.env` (`POLL_INTERVAL=30000`)

```javascript
const POLL_INTERVAL = 30000;  // Change to desired milliseconds (30000 = 30s)
```

### 8. Modify Wave Gap Duration

**File**: `lib/config.js` (`WAVE_GAP_MS`) or `.env` (`WAVE_GAP_MS=1200000`)

```javascript
const WAVE_GAP_MS = 20 * 60 * 1000;  // 20 minutes in ms
```

Change `20` to desired minutes. Smaller gap = more waves, larger gap = fewer but longer waves.

### 9. Add New Features to ML Model

**File**: `train-model.js`

Features are defined in a single source of truth: `lib/ml/features.js`. To add a new feature:

**Step 1**: Add feature definition to `FEATURE_DEFINITIONS` in `lib/ml/features.js`

**Step 2**: Add extraction logic in `extractFeatures()` in the same file

**Step 3**: Update `FEATURE_NAMES` in `lib/config.js` to match

**Step 4**: Run `npm run train` to retrain the model with the new feature

The model input shape is derived automatically from the feature count. The validation system (`lib/ml/validate-model.js`) will catch any mismatches at server startup.

### 10. Change Panel Size/Position

**File**: `public/css/styles.css`

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
npm start

# Terminal 2: Start collector
npm run collect

# Terminal 3: Manual training (optional)
npm run train
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
[ML] Model loaded (alpha, waves, val_acc from model/metrics.json)
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
Open this file on disk for current numbers. Typical keys:
```json
{
  "trainedAt": "<ISO8601>",
  "wavesUsed": "<integer>",
  "totalSamples": "<integer>",
  "positiveRate": "<number>",
  "validation": {
    "accuracy": "<number>",
    "precision": "<number>",
    "recall": "<number>",
    "f1": "<number>"
  },
  "full": { },
  "alpha": "<number>",
  "bestValAcc": "<number>",
  "bestEpoch": "<number>",
  "featureNames": [ ],
  "classWeights": { },
  "hyperparams": { "epochs": 80, "batchSize": 64, "learningRate": 0.001 }
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

**Unit Tests**: 34 Jest tests covering alert classification, geographic calculations, and wave detection.

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:calibration  # Model calibration validation
npm run validate:model    # Feature/model compatibility check
npm run check:features    # Print current feature set
```

**Calibration Testing**: Tests model predictions on held-out waves, groups into 10% probability buckets, and validates actual conversion rates per bucket.

**Recommended Additional Tests** (for production):
- Integration tests for data collection pipeline
- End-to-end tests for prediction API
- UI tests for critical user flows

---

## 🤝 Contributing

### Making Changes

1. **Test locally** with `npm start` + `npm run collect`
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

## 📚 Documentation

Detailed documentation in `docs/`:

- **`MULTI_MISSILE.md`**: Multi-missile detection & visualization
- **`FEATURE_SYSTEM.md`**: Feature mismatch prevention system
- **`MODEL_CALIBRATION_REPORT.md`**: Model calibration analysis
- **`CANARY_CITIES.md`**: Canary city discovery & fix
- **`REGIONAL_ATTACK_FIX.md`**: Critical fix for simultaneous regional attacks (80km threshold)
- **`ARCHITECTURE.md`**: System architecture
- **`TECHNICAL.md`**: Technical deep-dive
- **`archive/`**: Historical documentation & old reports

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

**Last Updated**: March 24, 2026
**Project Status**: Active Development
**Current Model**: v1.2, 17 features; see `model/metrics.json` for validation accuracy, wave count, and sample counts
