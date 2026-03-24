# Feature Mismatch Prevention System

## Problem
Model expecting different feature count than code provides (e.g., "expected 17 but got 14").

## Solution
Single source of truth + automatic validation at startup.

---

## Architecture

```
lib/ml/features.js (17 features)
         ↓
    ┌────┴────┬────────┬────────┐
    ↓         ↓        ↓        ↓
Training  Server   Tests   Analysis
```

---

## Quick Commands

```bash
# Check features
npm run check:features        # ✅ Feature count: 17

# Validate model
npm run validate:model        # ✅ Model validation passed

# Test calibration
npm run test:calibration      # Calibration results

# Retrain after changes
npm run train
```

---

## Adding a Feature

1. **Edit** `lib/ml/features.js`:
   - Add to `FEATURE_DEFINITIONS`
   - Add calculation to `extractFeatures()`

2. **Retrain**: `npm run train`

3. **Start**: `npm start`

4. **Done!** Validation ensures everything matches.

---

## How It Prevents Mismatches

### Before:
- Features in 5+ files
- Easy to forget updates
- Runtime errors

### After:
- One source of truth
- Validation at startup
- Clear error messages

---

## Files

| File | Purpose |
|------|---------|
| `lib/ml/features.js` | Feature definitions |
| `lib/ml/validate-model.js` | Validation logic |
| `src/server.js` | Uses centralized features |
| `scripts/test-prediction-calibration.js` | Uses centralized features |

---

## Validation Example

```bash
$ npm start

[ML] Validating model compatibility...
[ML] ✅ Validation passed (17 features)
[ML] Model loaded (alpha=0.85, waves=115, val_acc=92.0%)
```

If mismatch:
```
[ML] ❌ MODEL VALIDATION FAILED:
     Feature count mismatch: expected 18 but got 17
     Solution: Run 'npm run train'
```

---

**Status**: ✅ Production-ready  
**Created**: 2026-03-15
