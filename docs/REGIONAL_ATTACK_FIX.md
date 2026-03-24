# Regional Attack Separation Fix

**Date:** 2026-03-14  
**Issue:** Model was incorrectly applying red alert data from distant attacks to unrelated orange alerts

## Problem

When simultaneous attacks occurred in different regions (e.g., North and Tel Aviv), the system was:
1. Using red cities from the North to calculate the center for Tel Aviv orange predictions
2. Applying "red feedback" (probability reduction) based on distant reds that weren't related to the local orange zone
3. This resulted in very low probabilities (e.g., 1-5%) for cities that should have shown high risk (99%)

### Example Scenario
- **North attack**: 40 red alerts near Lebanon border (~33.5°N)
- **Tel Aviv attack**: 137 orange alerts in Tel Aviv metro area (~32.1°N)
- **Distance**: 121 km apart (clearly separate attacks)
- **Bug**: System calculated center from North reds and used it for Tel Aviv predictions
- **Result**: Tel Aviv orange cities showed 1-5% probability instead of 99%

## Solution

Implemented **distance-based center selection** with 80km threshold:

### Logic
```javascript
if (redCities.length > 0) {
  const redCenter = centroid(redCities);
  const orangeCenter = centroid(orangeCities);
  const distBetweenCenters = haversineDistance(redCenter, orangeCenter);
  
  if (distBetweenCenters < 80) {
    // Same attack - use red center
    actualCenter = redCenter;
    useRedCenter = true;
  } else {
    // Different attacks - use orange center
    actualCenter = orangeCenter;
    useRedCenter = false;
  }
}

// Red feedback ONLY if red cities are from same attack
const redFeedbackMultiplier = useRedCenter 
  ? calculateFeedback(orangeCities, redCities, timeElapsed)
  : 1.0; // No reduction for separate attacks
```

### Files Updated

1. **`src/server.js`** (Lines 200-235)
   - Live prediction API endpoint
   - Added center distance check
   - Conditional red feedback application

2. **`src/train-model.js`** (Lines 95-127)
   - Model training data generation
   - Ensures training data uses correct centers
   - Critical for model accuracy

3. **`scripts/test-prediction-calibration.js`** (Lines 70-95)
   - Calibration testing
   - Validates model performance on historical data

4. **`scripts/analyze-model-calibration.js`** (Lines 79-105)
   - Model analysis and debugging
   - Statistical evaluation of predictions

## Validation

### Before Fix
```
Tel Aviv (center alert) → 1.28% (WRONG - using North red center)
Tel Aviv (suburb)       → 0.83% (WRONG)
```

### After Fix
```
Tel Aviv (center alert) → 99.42% (CORRECT - using Tel Aviv orange center)
Tel Aviv (suburb)       → 99.18% (CORRECT)
redFeedbackMultiplier   → 1.0 (no reduction from distant reds)
```

## Technical Details

### Threshold Selection: 80km
- **Typical missile impact zone**: 20-40 km radius
- **Safety margin**: 2x typical zone = ~80 km
- **Real-world validation**: Tel Aviv metro area is ~30 km wide
- **Edge cases**: Allows for large metropolitan areas while clearly separating North/Center/South attacks

### Multi-Missile Detection
The multi-missile detection system correctly identified 2 clusters:
```
Cluster 1: TEL_AVIV_CENTER (137 cities)
Cluster 2: NORTH (40 cities)
Separation: 121 km
```

However, it was still using the NORTH cluster center for TEL_AVIV predictions. This fix ensures:
- Multi-missile detection still runs (identifies attack patterns)
- But center selection is regional-aware
- Red feedback only applies within the same region

## Next Steps

1. ✅ Fixed all center calculation code
2. ⏭️ Retrain model with corrected logic
3. ⏭️ Run calibration tests to verify improvement
4. ⏭️ Monitor live predictions for edge cases

## Related Documents
- [Multi-Missile Detection](./MULTI_MISSILE.md)
- [Model Calibration Report](./MODEL_CALIBRATION_REPORT.md)
- [Feature System](./FEATURE_SYSTEM.md)
