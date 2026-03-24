# Multi-Missile UI Visualization

## Overview

When the system detects **2+ separated missile clusters** (red polygons apart with gaps), it displays:
- **Multiple center markers** on the map (one per cluster)
- **Separate countdown timers** for each cluster
- **Visual distinction** with different colors per cluster

## Detection Criteria

Multi-missile is detected when **red alerts** show:
1. **Separation**: Cluster centers >50km apart
2. **Cluster size**: Secondary cluster ≥20 cities
3. **Balance**: Secondary/primary ratio ≥15%

## Visual Signature

The key visual pattern that indicates multi-missile:
- **Red polygons are separated** on the map
- **Oranges/gaps exist between** the red clusters
- Average **27% of oranges** fall in the gap zone

## UI Components

### Live Alerts Tab

#### Single-Missile Display
```
┌─────────────────────────────────────┐
│ 🚀 איום פעיל - גל התקפה            │
├─────────────────────────────────────┤
│ איזור התרעה: 150 ישובים            │
│ זמן צפוי לאזעקה: ~8:30 דקות        │
│ רמת איום: גבוה (72%)                │
│ 🎯 מוקד צפוי: 31.972, 35.018       │
└─────────────────────────────────────┘
```

**Map**: Single red center marker with concentric threat circles

#### Multi-Missile Display
```
┌─────────────────────────────────────┐
│ ⚠️ איום מרובה - 2 טילים זוהו       │
│ מרחק בין מוקדים: 68 ק"מ            │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ 🎯 טיל ראשון - TEL_AVIV_CENTER     │
├─────────────────────────────────────┤
│ ישובים באזור: 314                   │
│ זמן צפוי: ~7:45 דקות                │
│ רמת איום: גבוה (68%)                │
│ 🎯 מוקד: 31.973, 35.018            │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ 🎯 טיל שני - SOUTH                 │
├─────────────────────────────────────┤
│ ישובים באזור: 72                    │
│ זמן צפוי: ~9:15 דקות                │
│ רמת איום: בינוני (54%)              │
│ 🎯 מוקד: 31.419, 34.717            │
└─────────────────────────────────────┘
```

**Map**: Multiple colored center markers (red, purple, cyan) with separate threat zones

### History Tab Timeline

When replaying a multi-missile wave:
- **Cluster center markers** appear on the map during red phase
- **Timeline panel** shows: `⚠️ 2 מוקדים | 68 ק"מ`
- **Color-coded markers**: Red for primary, Purple for secondary

## Technical Implementation

### API Response Structure

```json
{
  "multiMissile": {
    "detected": true,
    "clusterCount": 2,
    "separation": 68,
    "balance": 23,
    "clusters": [
      {
        "size": 314,
        "center": { "lat": 31.9726, "lng": 35.0184 },
        "seedName": "TEL_AVIV_CENTER",
        "cities": ["תל אביב - מרכז העיר", "בני ברק", ...]
      },
      {
        "size": 72,
        "center": { "lat": 31.4191, "lng": 34.7168 },
        "seedName": "SOUTH",
        "cities": ["אשדוד - א,ב,ד,ה", "נתיבות", ...]
      }
    ]
  }
}
```

### Frontend Logic

The UI automatically adapts based on `predRes.multiMissile.detected`:

**Multi-missile path**:
1. Display warning header with cluster count and separation
2. For each cluster:
   - Filter cities by nearest cluster center
   - Calculate independent timing and threat level
   - Show separate timer card with cluster-specific data
3. Map shows multiple colored center markers

**Single-missile path**:
1. Display standard warning header
2. Show one unified timer card
3. Map shows single center marker

### Styling

- **Multi-missile cards**: Pulsing red border animation
- **Cluster cards**: Color-coded borders (red, purple, cyan)
- **Center markers**: Animated pulse with z-index stacking
- **Timeline tag**: Red background badge with cluster info

## Validation Results

Tested on historical waves:
- ✅ **16:25** - Correctly detects Central + South (68km, 2 clusters)
- ✅ **14:39** - Correctly single-missile (Jerusalem focused)
- ✅ **14:59** - Correctly detects Jerusalem + South (56km, 2 clusters)

## Model Training Features

New spatial gap features added to ML model (v1.2):
- `multi_missile_detected` (0/1)
- `cluster_separation_km` (distance between centers)
- `gap_orange_percentage` (% of oranges in gap zone)
- `city_in_minority_cluster` (0/1)

These features help the model learn that:
- Red polygons separated by gaps indicate multiple missiles
- Cities in smaller clusters are still real threats
- Normal distance-based logic is less reliable in multi-missile scenarios

## User Experience

**Before**: Single center, all cities judged by distance to one point → incorrect predictions for separated clusters

**After**: Multiple centers, cluster-specific timing and threat assessment → accurate predictions for each impact zone

The visual UI clearly shows when multiple threats are active, helping users understand the attack pattern at a glance.
