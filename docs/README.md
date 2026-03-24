# Documentation Index

## Getting Started

| Document | Description |
|----------|-------------|
| **QUICK_START.md** | **How to install, run, and use the project** |

## Core Documentation

| Document | Description |
|----------|-------------|
| **ARCHITECTURE.md** | System architecture & data flow |
| **TECHNICAL.md** | Technical deep-dive & implementation details |
| **MULTI_MISSILE.md** | Multi-missile detection system |
| **FEATURE_SYSTEM.md** | Feature mismatch prevention (how to add features safely) |
| **MODEL_CALIBRATION_REPORT.md** | Model probability calibration analysis |
| **REGIONAL_ATTACK_FIX.md** | Separating distant simultaneous attacks for accurate predictions |
| **CANARY_CITIES.md** | Canary city discovery & fix |
| **VISUAL_DEMO.md** | UI demonstrations & examples |

---

## Quick References

### 📊 Model Status
- **Accuracy**: See model/metrics.json for latest accuracy
- **Features**: 17
- **Version**: 1.2 (with spatial gap features)

### 🛠️ Common Tasks

**Add new feature:**
```bash
# Edit lib/ml/features.js
# Run training
npm run train
# Validation happens automatically on start
npm start
```

**Check features:**
```bash
npm run check:features
```

**Validate model:**
```bash
npm run validate:model
```

**Test calibration:**
```bash
npm run test:calibration
```

---

## Archive

Historical documentation moved to `archive/`:
- Old status reports (MULTI_MISSILE_COMPLETE, COUNTDOWN_FIX, etc.)
- Old implementation summaries
- Deprecated documentation

These are kept for reference but not actively maintained.

---

**Last Updated**: March 24, 2026
