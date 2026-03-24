# Multi-Missile Detection System

## Overview
Detects and visualizes when multiple missiles target separate geographic regions simultaneously.

---

## Key Insight
**Red polygons are geographically separated with orange alerts between them.**

From 162 historical waves:
- **11% were multi-missile attacks**
- **Average 82km separation** between clusters
- **27% of oranges** fall in gap between clusters

---

## How It Works

### 1. Detection Algorithm

```
Red cities → K-means clustering → Validate separation
     ↓                ↓                    ↓
  Input           Find 2 clusters     >50km apart?
                                      >20 cities each?
```

**Thresholds**:
- Minimum separation: 50km
- Minimum cluster size: 20 cities
- Balance requirement: Smaller cluster ≥15% of larger

### 2. ML Features

4 features added to model (v1.2):
- `multi_missile_detected` - Binary flag
- `cluster_separation_km` - Distance between centers
- `gap_orange_percentage` - % of oranges in gap
- `city_in_minority_cluster` - In smaller cluster?

**Impact**: Model accuracy improved to **91.8%**

### 3. UI Visualization

**Single-Missile**: One timer, one center marker

**Multi-Missile**: Multiple timers, cluster markers with colors

```
🎯 מוקד 1: תל אביב (314 ישובים)
🎯 מוקד 2: דרום (72 ישובים)
📏 ריחוק: 68 ק"מ
```

---

## Code Files

| File | Purpose |
|------|---------|
| `lib/utils/multi-missile.js` | Detection logic |
| `public/js/alerts.js` | UI rendering |
| `lib/ml/features.js` | ML features |

---

## Examples

**Multi-Missile Waves** (from history):
- **16:25** - Central (314) + South (72), 68km apart
- **14:59** - Jerusalem (107) + South (25), 56km apart
- **14:39** - Single missile (Jerusalem only)

---

## Statistics

From 162 waves analyzed:
- **Multi-missile conversion rate**: 69%
- **Single-missile conversion rate**: 42%
- **Multi-missile attacks are 1.6x more dangerous**

---

**Status**: ✅ Production (Model v1.2)  
**Created**: March 2026
