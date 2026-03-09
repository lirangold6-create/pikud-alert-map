# System Architecture Diagram

## 🏗️ Complete System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL DATA SOURCES                               │
└─────────────────────────────────────────────────────────────────────────────┘
           │                        │                         │
           │                        │                         │
           ▼                        ▼                         ▼
    ┌──────────────┐       ┌──────────────┐        ┌──────────────┐
    │   Oref API   │       │  Oref Full   │        │  Tzevaadom   │
    │  AlertsHist  │       │   History    │        │     API      │
    │ (50-min win) │       │ (city-spec)  │        │ (red events) │
    └──────────────┘       └──────────────┘        └──────────────┘
           │                        │                         │
           │                        │                         │
           └────────────────────────┼─────────────────────────┘
                                    │
                                    │ Every 30s
                                    ▼
           ┌────────────────────────────────────────────────┐
           │         COLLECTOR.JS (Background Service)      │
           │  • Polls 3 data sources                        │
           │  • Deduplicates alerts                         │
           │  • Detects wave boundaries (20-min gap)        │
           │  • Identifies completed waves                  │
           │  • Triggers auto-retraining                    │
           └────────────────────────────────────────────────┘
                      │                          │
                      │                          │
                      ▼                          ▼
        ┌──────────────────────┐    ┌──────────────────────┐
        │ collected-alerts.json│    │collected-waves.json  │
        │ { "key": {           │    │ [{ id, startTime,    │
        │   alertDate, data,   │    │    cities: {...},    │
        │   title, category    │    │    summary: {...}    │
        │ }}                   │    │ }]                   │
        │                      │    │                      │
        │ 12,803 alerts        │    │ 98 waves (63 done)   │
        └──────────────────────┘    └──────────────────────┘
                                              │
                                              │
                     When new completed wave  │
                          (hasGreen + ≥5)     │
                                              ▼
                        ┌─────────────────────────────────┐
                        │   TRAIN-MODEL.JS (Triggered)     │
                        │  • Load completed waves          │
                        │  • Extract 12 features/city      │
                        │  • Normalize features (Z-score)  │
                        │  • Train neural network (80 ep)  │
                        │  • Compute blend alpha           │
                        │  • Evaluate on validation set    │
                        │  • Save model + metrics          │
                        │                                  │
                        │  Training time: ~15 seconds      │
                        └─────────────────────────────────┘
                                     │
                                     │ Saves to disk
                                     ▼
                ┌────────────────────────────────────────────┐
                │          MODEL/ DIRECTORY                  │
                │  ┌────────────────────────────────────┐   │
                │  │ model.json (TF.js architecture)    │   │
                │  │ weights.bin (trained parameters)   │   │
                │  │ normalization.json (μ, σ)          │   │
                │  │ metrics.json (accuracy, alpha)     │   │
                │  └────────────────────────────────────┘   │
                └────────────────────────────────────────────┘
                                     │
                                     │ File watcher detects
                                     ▼
         ┌─────────────────────────────────────────────────────┐
         │          SERVER.JS (Node.js HTTP Server)             │
         │                                                      │
         │  ┌─────────────────────────────────────────────┐   │
         │  │  Model Loading & Watching                    │   │
         │  │  • Loads TF.js model on startup              │   │
         │  │  • Watches model/ dir for changes            │   │
         │  │  • Auto-reloads when files update            │   │
         │  └─────────────────────────────────────────────┘   │
         │                                                      │
         │  ┌─────────────────────────────────────────────┐   │
         │  │  API Endpoints                               │   │
         │  │                                              │   │
         │  │  /api/alerts        → Live alerts (proxy)   │   │
         │  │  /api/history       → Recent alerts (proxy) │   │
         │  │  /api/cities        → City metadata         │   │
         │  │  /api/polygons      → City boundaries       │   │
         │  │  /api/predict       → ML predictions ⭐      │   │
         │  │  /api/model-info    → Model status          │   │
         │  │  /api/leaderboard   → Top cities            │   │
         │  │  /api/full-history  → Historical data       │   │
         │  │  /api/collected     → Local storage query   │   │
         │  │                                              │   │
         │  │  /                  → index.html            │   │
         │  └─────────────────────────────────────────────┘   │
         │                                                      │
         │  Port 3000                                           │
         └─────────────────────────────────────────────────────┘
                           │
                           │ HTTP
                           ▼
    ┌──────────────────────────────────────────────────────────┐
    │              FRONTEND (index.html + JS)                   │
    │                                                           │
    │  ┌─────────────────────────────────────────────────┐    │
    │  │  UI Layout                                       │    │
    │  │  ┌─────────────────────────────────────────┐   │    │
    │  │  │  Panel (right side, fixed)              │   │    │
    │  │  │  ┌───────────────────────────────────┐ │   │    │
    │  │  │  │ Header: "מפת התרעות חיות"       │ │   │    │
    │  │  │  └───────────────────────────────────┘ │   │    │
    │  │  │  ┌───────────────────────────────────┐ │   │    │
    │  │  │  │ Tabs: [Live|History|Leaderboard]  │ │   │    │
    │  │  │  └───────────────────────────────────┘ │   │    │
    │  │  │  ┌───────────────────────────────────┐ │   │    │
    │  │  │  │ Content (scrollable)              │ │   │    │
    │  │  │  │  • Favorites section              │ │   │    │
    │  │  │  │  • Red alerts                     │ │   │    │
    │  │  │  │  • Orange alerts + probabilities  │ │   │    │
    │  │  │  │  • Green alerts                   │ │   │    │
    │  │  │  └───────────────────────────────────┘ │   │    │
    │  │  └─────────────────────────────────────────┘   │    │
    │  │  Map (Leaflet.js) - Full viewport, below panel  │    │
    │  └─────────────────────────────────────────────────┘    │
    │                                                           │
    │  ┌─────────────────────────────────────────────────┐    │
    │  │  Refresh Cycle (every 5 seconds)                 │    │
    │  │                                                   │    │
    │  │  1. Fetch /api/alerts                           │    │
    │  │  2. Classify by type (red/orange/green)          │    │
    │  │  3. For orange alerts:                           │    │
    │  │     • Calculate zone center (centroid)           │    │
    │  │     • Call /api/predict                          │    │
    │  │     • Receive blended probabilities             │    │
    │  │  4. Update UI:                                   │    │
    │  │     • Favorites status                           │    │
    │  │     • Alert lists with probabilities            │    │
    │  │     • Map polygons (color by probability)       │    │
    │  │     • Distance rings                             │    │
    │  │  5. Auto-center map (unless user moved it)       │    │
    │  └─────────────────────────────────────────────────┘    │
    │                                                           │
    │  ┌─────────────────────────────────────────────────┐    │
    │  │  Favorites System (localStorage)                 │    │
    │  │  • Star/unstar cities                            │    │
    │  │  • Persist across refreshes                      │    │
    │  │  • Show current status in all tabs              │    │
    │  └─────────────────────────────────────────────────┘    │
    └──────────────────────────────────────────────────────────┘
```

---

## 🔄 Data Flow: Live Prediction

```
User opens browser
       ↓
1. Load static assets (HTML, CSS, JS)
       ↓
2. Fetch city metadata & polygons
   GET /api/cities, /api/polygons
       ↓
3. Start 5-second refresh cycle
       ↓
┌──────────────────────────────────────┐
│    EVERY 5 SECONDS:                  │
│                                      │
│  Fetch live alerts                   │
│  GET /api/alerts                     │
│       ↓                              │
│  Parse alerts by type                │
│  • Red: ירי רקטות וטילים            │
│  • Orange: בדקות הקרובות...          │
│  • Green: האירוע הסתיים             │
│       ↓                              │
│  IF orange alerts exist:             │
│    Calculate zone centroid           │
│    Build city list                   │
│         ↓                            │
│    Call ML prediction API            │
│    GET /api/predict?                 │
│      cities=city1,city2,...          │
│      &centerLat=32.08                │
│      &centerLng=34.78                │
│      &zoneSize=50                    │
│         ↓                            │
│    Receive predictions:              │
│    {                                 │
│      "city1": {                      │
│        prob: 73,    // Blended      │
│        ml: 78,      // ML model     │
│        dist: 65,    // Distance     │
│        source: "blended"            │
│      },                              │
│      ...                             │
│    }                                 │
│         ↓                            │
│  Update UI:                          │
│  • Favorites: ⭐ City (73%)          │
│  • Orange list: sorted by prob      │
│  • Polygons: colored by prob        │
│  • Markers: sized by prob           │
│  • Distance rings from center       │
│       ↓                              │
│  IF no user interaction:             │
│    Auto-center map to show alerts   │
│                                      │
└──────────────────────────────────────┘
       ↓
   Repeat after 5 seconds
```

---

## 🤖 Machine Learning Prediction Flow

```
/api/predict receives request
       ↓
┌────────────────────────────────────────────────┐
│  1. Load ML Model (if not already loaded)      │
│     • TensorFlow.js model                      │
│     • Normalization parameters                 │
│     • Training metrics (for alpha)             │
└────────────────────────────────────────────────┘
       ↓
┌────────────────────────────────────────────────┐
│  2. For each city in request:                  │
│                                                 │
│     A. DISTANCE-BASED PREDICTION               │
│        distance = haversine(city, center)      │
│        dist_prob = interpolate(PROB_CURVE)     │
│                                                 │
│     B. ML PREDICTION (if model loaded)         │
│        features = [                            │
│          distance,                             │
│          bearing_sin, bearing_cos,             │
│          orange_zone_size,                     │
│          city_lat, city_lng,                   │
│          center_lat, center_lng,               │
│          countdown,                            │
│          hour_sin, hour_cos,                   │
│          city_historical_red_rate              │
│        ]                                       │
│        normalized = normalize(features)        │
│        ml_prob = model.predict(normalized)     │
│                                                 │
│     C. BLEND PREDICTIONS                       │
│        alpha = metrics.alpha  // e.g., 0.70   │
│        final = alpha × ml_prob +               │
│                (1-alpha) × dist_prob           │
│                                                 │
│        Example:                                │
│        ML: 85%, Distance: 60%, Alpha: 0.7     │
│        Final: 0.7×85 + 0.3×60 = 77.5%         │
└────────────────────────────────────────────────┘
       ↓
┌────────────────────────────────────────────────┐
│  3. Return predictions with metadata:          │
│     {                                          │
│       predictions: { city: {prob,ml,dist} },   │
│       model: {                                 │
│         alpha: 0.7,                            │
│         accuracy: 0.879,                       │
│         wavesUsed: 63,                         │
│         trainedAt: "2026-03-09T15:03:39Z"      │
│       }                                        │
│     }                                          │
└────────────────────────────────────────────────┘
       ↓
   Frontend displays results
```

---

## 🔄 Auto-Retraining Cycle

```
Event occurs in real world
       ↓
Pikud HaOref issues alerts
       ↓
┌─────────────────────────────────────────────────┐
│  COLLECTOR.JS (polling every 30 seconds)        │
│                                                  │
│  1. Fetch new alerts from 3 sources             │
│  2. Deduplicate (by alertDate|city|title)       │
│  3. Append to collected-alerts.json             │
│       ↓                                          │
│  4. Rebuild waves (20-min gap)                  │
│     Group alerts into waves                     │
│     For each wave, track per city:              │
│     • orange: got warning                       │
│     • red: got rocket alert                     │
│     • green: got all-clear                      │
│       ↓                                          │
│  5. Save to collected-waves.json                │
│       ↓                                          │
│  6. Check for new completed waves               │
│     IF wave.hasGreen AND wave.warned >= 5       │
│        AND alertCount changed:                  │
│                                                  │
│        ┌──────────────────────────────────┐    │
│        │  TRIGGER RETRAINING              │    │
│        │  execFile('node train-model.js') │    │
│        └──────────────────────────────────┘    │
│                ↓                                 │
└────────────────┼─────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  TRAIN-MODEL.JS (child process, ~15s)           │
│                                                  │
│  1. Load collected-waves.json                   │
│  2. Filter to completed waves (hasGreen + ≥5)   │
│  3. Extract features for each warned city       │
│     • 12 features per city per wave             │
│     • Label: 1 if got red, 0 if not            │
│       ↓                                          │
│  4. Compute normalization (μ, σ for each feat)  │
│  5. Split 80/20 train/validation                │
│  6. Build neural network (32→16→1)              │
│  7. Train 80 epochs with class weights          │
│     • Early stopping (save best model)          │
│     • Dropout for regularization               │
│       ↓                                          │
│  8. Evaluate on validation set                  │
│     • Accuracy, Precision, Recall, F1          │
│       ↓                                          │
│  9. Compute alpha (blend factor)                │
│     Based on: waves_count + accuracy            │
│       ↓                                          │
│  10. Save to model/ directory:                  │
│      • model.json (architecture)                │
│      • weights.bin (trained parameters)         │
│      • normalization.json (μ, σ)                │
│      • metrics.json (accuracy, alpha, etc.)     │
│                                                  │
│  Output: "Training Complete"                    │
└─────────────────────────────────────────────────┘
                 │
                 │ Files written to disk
                 ▼
┌─────────────────────────────────────────────────┐
│  SERVER.JS (file watcher active)                │
│                                                  │
│  Detects model.json or metrics.json changed     │
│       ↓                                          │
│  Wait 1 second (debounce for all files)         │
│       ↓                                          │
│  Reload model asynchronously                    │
│  • Load new TF.js model                         │
│  • Load new normalization params               │
│  • Load new metrics (alpha, accuracy)           │
│       ↓                                          │
│  Log: "[ML] Model reloaded successfully"        │
│  Log: "alpha=0.70, waves=63, val_acc=87.9%"    │
└─────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  Next /api/predict request                      │
│  Uses updated model for predictions             │
│  System has learned from latest event!          │
└─────────────────────────────────────────────────┘
```

---

## 📊 Favorites System Flow

```
User clicks star (☆) next to city
       ↓
JavaScript: toggleFavorite(cityName)
       ↓
┌────────────────────────────────────┐
│  1. Load from localStorage          │
│     key: 'favoriteCities'           │
│     value: ["city1", "city2", ...]  │
└────────────────────────────────────┘
       ↓
┌────────────────────────────────────┐
│  2. Toggle city in array            │
│     IF city in array:               │
│       Remove it                     │
│     ELSE:                           │
│       Add it                        │
└────────────────────────────────────┘
       ↓
┌────────────────────────────────────┐
│  3. Save to localStorage            │
│     localStorage.setItem(           │
│       'favoriteCities',             │
│       JSON.stringify(updatedArray)  │
│     )                               │
└────────────────────────────────────┘
       ↓
┌────────────────────────────────────┐
│  4. Refresh UI immediately          │
│     refreshAlerts()                 │
│       ↓                             │
│     Star icon updates:              │
│     ☆ → ⭐ (or vice versa)          │
│       ↓                             │
│     Favorites section updates:      │
│     ┌────────────────────────────┐ │
│     │ ⭐ ערים מועדפות           │ │
│     │ ⭐ רעננה       73% סיכוי   │ │
│     │ ⭐ תל אביב     בטוח        │ │
│     └────────────────────────────┘ │
└────────────────────────────────────┘
       ↓
Persists across:
• Page refresh
• Browser restart
• All tabs (Live, History, Leaderboard)
```

---

## 🗺️ Map Interaction Flow

```
User opens page
       ↓
Map initializes at default position
(center: [31.5, 34.9], zoom: 8)
       ↓
userMovedMap = false
       ↓
┌──────────────────────────────────────────┐
│  AUTO-CENTERING ACTIVE                   │
│                                          │
│  On each refresh:                        │
│    IF alerts exist:                      │
│      Calculate bounds of all alerts      │
│      map.fitBounds(bounds)               │
│                                          │
│  Map shows all active alerts             │
└──────────────────────────────────────────┘
       ↓
User drags map or zooms manually
       ↓
Event listener triggers:
• map.on('dragstart') → userMovedMap = true
• map.on('zoomstart') → userMovedMap = true
       ↓
┌──────────────────────────────────────────┐
│  AUTO-CENTERING DISABLED                 │
│                                          │
│  On each refresh:                        │
│    IF userMovedMap:                      │
│      Skip fitBounds()                    │
│      Map stays where user positioned it  │
│                                          │
│  User has manual control                 │
└──────────────────────────────────────────┘
       ↓
To reset:
• Refresh page (Ctrl+R)
• Select city in History tab
  (triggers manual centering)
```

---

## 📁 File Dependencies

```
index.html
├── Uses: Leaflet.js (CDN)
├── Calls: server.js APIs
│   ├── /api/cities
│   ├── /api/polygons
│   ├── /api/alerts (every 5s)
│   ├── /api/predict (when orange alerts)
│   ├── /api/history
│   ├── /api/leaderboard
│   └── /api/collected
└── Stores: localStorage
    └── favoriteCities: ["city1", "city2"]

server.js
├── Depends on:
│   ├── pikud-haoref-api/cities.json
│   ├── pikud-haoref-api/polygons.json
│   ├── collected-alerts.json
│   ├── model/ (optional, for ML)
│   │   ├── model.json
│   │   ├── weights.bin
│   │   ├── normalization.json
│   │   └── metrics.json
│   └── axios (HTTP requests)
└── Serves: index.html, API endpoints

collector.js
├── Polls:
│   ├── Oref APIs (AlertsHistory, GetAlarmsHistory)
│   └── Tzevaadom API
├── Writes to:
│   ├── collected-alerts.json
│   └── collected-waves.json
└── Executes: train-model.js (when wave completes)

train-model.js
├── Depends on:
│   ├── @tensorflow/tfjs-node
│   ├── collected-waves.json
│   └── pikud-haoref-api/cities.json
└── Writes to:
    └── model/
        ├── model.json
        ├── weights.bin
        ├── normalization.json
        └── metrics.json

package.json
└── Dependencies:
    └── @tensorflow/tfjs-node: ^4.22.0
```

---

## 🔌 External Dependencies

```
┌──────────────────────────┐
│  pikud-haoref-api         │
│  (Git submodule)          │
│                           │
│  Provides:                │
│  • cities.json            │
│  • polygons.json          │
│  • City metadata          │
│    (name, zone, coords,   │
│     countdown)            │
└──────────────────────────┘

┌──────────────────────────┐
│  Leaflet.js               │
│  (CDN: unpkg.com)         │
│                           │
│  Used for:                │
│  • Map rendering          │
│  • Polygons               │
│  • Markers                │
│  • Popups                 │
└──────────────────────────┘

┌──────────────────────────┐
│  @tensorflow/tfjs-node    │
│  (npm package)            │
│                           │
│  Used for:                │
│  • Model training         │
│  • Inference              │
│  • No Python needed!      │
└──────────────────────────┘

┌──────────────────────────┐
│  Oref APIs                │
│  (oref.org.il)            │
│                           │
│  Provides:                │
│  • Live alerts            │
│  • Historical data        │
│  • Official source        │
└──────────────────────────┘

┌──────────────────────────┐
│  Tzevaadom API            │
│  (tzevaadom.co.il)        │
│                           │
│  Provides:                │
│  • Red alert events       │
│  • Additional validation  │
└──────────────────────────┘
```

---

## 🚦 Component States

### Server (server.js)
```
States:
├─► STARTING
│   • Loading city/polygon data
│   • Attempting to load ML model
│
├─► READY (no ML)
│   • Serving APIs
│   • Using distance-based predictions only
│   • Alpha = 0 (or very low)
│
└─► READY (with ML)
    • Serving APIs
    • Using blended predictions
    • Alpha = 0.70
    • Watching model/ for updates
```

### Collector (collector.js)
```
States:
├─► INITIALIZING
│   • Loading existing data files
│   • Starting from last state
│
├─► POLLING
│   • Fetching new alerts every 30s
│   • Writing to disk when new data
│   • Printing '.' when no new data
│
└─► RETRAINING (temporary)
    • Detected new completed wave
    • Spawned train-model.js
    • Waiting for completion (~15s)
    • Then returns to POLLING
```

### Frontend (index.html)
```
States:
├─► LOADING
│   • Fetching initial data
│   • Loading cities, polygons
│
├─► REFRESHING (every 5s cycle)
│   • Fetching live alerts
│   • Calling prediction API
│   • Updating UI
│
├─► IDLE (between refreshes)
│   • Showing static content
│   • Countdown ticking
│   • User can interact
│
└─► USER INTERACTION
    • User clicked star (toggle favorite)
    • User selected city (history)
    • User clicked leaderboard city
    • User moved/zoomed map
```

---

This architecture enables:
✅ Real-time predictions (<5s latency)
✅ Continuous learning (automatic after each event)
✅ Graceful degradation (distance fallback if ML fails)
✅ User-friendly interface (favorites, history, leaderboards)
✅ Easy monitoring (logs, metrics, browser console)
✅ Simple deployment (3 Node.js processes)
