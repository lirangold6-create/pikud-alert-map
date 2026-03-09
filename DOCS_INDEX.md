# Documentation Index

Welcome to the Pikud HaOref ML Alert System documentation! This guide helps you navigate all available documentation and find exactly what you need.

---

## 📚 Documentation Overview

### 1. **README.md** - Complete Project Guide
**When to read**: First thing, before anything else

**What's inside**:
- Project overview and goals
- Complete file structure
- Architecture and data flow
- API endpoint documentation
- ML model details
- How to make common changes
- Running instructions
- Troubleshooting guide

**Read this if you want to**:
- Understand the entire system
- Find out what each file does
- Learn how to modify specific features
- Debug issues

[📖 Read README.md](README.md)

---

### 2. **QUICK_START.md** - Get Running in 5 Minutes
**When to read**: You want to get the system running immediately

**What's inside**:
- Minimal installation steps
- How to start server + collector
- Basic usage instructions
- Health monitoring commands
- Quick troubleshooting

**Read this if you want to**:
- Start the system right now
- Test if everything works
- Learn basic commands

[🚀 Read QUICK_START.md](QUICK_START.md)

---

### 3. **TECHNICAL.md** - Machine Learning Deep Dive
**When to read**: You need to understand or modify the ML components

**What's inside**:
- Feature engineering (all 12 features explained)
- Neural network architecture details
- Training process breakdown
- Evaluation metrics (accuracy, precision, recall)
- Prediction blending algorithm
- Auto-retraining pipeline
- Performance optimizations
- Experimental results

**Read this if you want to**:
- Understand how predictions work
- Modify the ML model
- Add new features
- Tune hyperparameters
- Improve accuracy

[🧠 Read TECHNICAL.md](TECHNICAL.md)

---

### 4. **ARCHITECTURE.md** - Visual System Diagrams
**When to read**: You need to understand how components connect

**What's inside**:
- Complete system flow diagrams (ASCII art)
- Data flow: live prediction
- ML prediction flow
- Auto-retraining cycle
- Favorites system flow
- Map interaction flow
- File dependencies diagram
- Component states

**Read this if you want to**:
- See the big picture visually
- Understand data flow
- Debug multi-component issues
- Plan system modifications

[🏗️ Read ARCHITECTURE.md](ARCHITECTURE.md)

---

### 5. **CHANGELOG.md** - Project Development History
**When to read**: You want to understand why things are the way they are

**What's inside**:
- Phase-by-phase development timeline
- Features added in each phase
- Design decisions and rationale
- Challenges and solutions
- Metrics progression over time
- Lessons learned

**Read this if you want to**:
- Understand the project's evolution
- Learn from past decisions
- See how accuracy improved
- Get historical context

[📅 Read CHANGELOG.md](CHANGELOG.md)

---

## 🎯 Quick Navigation by Task

### I want to...

#### **Start using the system**
→ [QUICK_START.md](QUICK_START.md) - Section: "Get Running in 5 Minutes"

#### **Understand the overall system**
→ [README.md](README.md) - Section: "Architecture"  
→ [ARCHITECTURE.md](ARCHITECTURE.md) - Section: "Complete System Overview"

#### **Modify the ML model**
→ [TECHNICAL.md](TECHNICAL.md) - Section: "Neural Network Architecture"  
→ [README.md](README.md) - Section: "How to Make Common Changes" → #3

#### **Change the UI**
→ [README.md](README.md) - Section: "Frontend Design"  
→ Look at `index.html` directly with guidance from README

#### **Add a new feature**
→ [TECHNICAL.md](TECHNICAL.md) - Section: "Feature Engineering"  
→ [README.md](README.md) - Section: "How to Make Common Changes" → #9

#### **Fix a bug**
→ [README.md](README.md) - Section: "Troubleshooting"  
→ [QUICK_START.md](QUICK_START.md) - Section: "Common Issues"

#### **Understand predictions**
→ [TECHNICAL.md](TECHNICAL.md) - Section: "Prediction Blending"  
→ [ARCHITECTURE.md](ARCHITECTURE.md) - Section: "ML Prediction Flow"

#### **Check system health**
→ [QUICK_START.md](QUICK_START.md) - Section: "Monitoring System Health"

#### **Deploy to production**
→ [README.md](README.md) - Section: "Running the System"  
→ Note: Currently prototype, DB migration recommended for production

#### **Learn why something was built a certain way**
→ [CHANGELOG.md](CHANGELOG.md) - Browse by phase  
→ [README.md](README.md) - Section: "Notes for New Developers" → "Key Design Decisions"

---

## 🔍 Find Information By Topic

### **APIs**
- Endpoint list: [README.md](README.md) → "API Endpoints"
- Request/response examples: [README.md](README.md) → Each endpoint section
- How predictions work: [TECHNICAL.md](TECHNICAL.md) → "Machine Learning Prediction Flow"

### **Machine Learning**
- Model architecture: [TECHNICAL.md](TECHNICAL.md) → "Neural Network Architecture"
- Features: [TECHNICAL.md](TECHNICAL.md) → "Feature Engineering"
- Training: [TECHNICAL.md](TECHNICAL.md) → "Training Process"
- Blending: [TECHNICAL.md](TECHNICAL.md) → "Prediction Blending"
- Auto-retraining: [ARCHITECTURE.md](ARCHITECTURE.md) → "Auto-Retraining Cycle"

### **Data**
- File formats: [README.md](README.md) → "Data Files Details"
- Data flow: [ARCHITECTURE.md](ARCHITECTURE.md) → "Data Flow"
- Collection: [README.md](README.md) → "File Structure" → `collector.js`

### **Frontend**
- UI layout: [README.md](README.md) → "Frontend Design"
- Tabs: [README.md](README.md) → "Three Main Tabs"
- Colors: [README.md](README.md) → "Color Scheme"
- Map: [ARCHITECTURE.md](ARCHITECTURE.md) → "Map Interaction Flow"
- Favorites: [ARCHITECTURE.md](ARCHITECTURE.md) → "Favorites System Flow"

### **Configuration**
- Refresh interval: [README.md](README.md) → "How to Make Common Changes" → #1
- Wave gap: [README.md](README.md) → "How to Make Common Changes" → #8
- Model hyperparameters: [README.md](README.md) → "How to Make Common Changes" → #4
- Alpha blending: [README.md](README.md) → "How to Make Common Changes" → #5

### **Performance**
- Metrics: [TECHNICAL.md](TECHNICAL.md) → "Evaluation Metrics"
- History: [CHANGELOG.md](CHANGELOG.md) → "Key Metrics Progression"
- Optimizations: [TECHNICAL.md](TECHNICAL.md) → "Performance Optimizations"

### **Troubleshooting**
- Common issues: [QUICK_START.md](QUICK_START.md) → "Common Issues"
- Full guide: [README.md](README.md) → "Troubleshooting"
- Component states: [ARCHITECTURE.md](ARCHITECTURE.md) → "Component States"

---

## 📖 Reading Paths

### Path 1: Quick Start User
**Goal**: Get system running and use it

1. [QUICK_START.md](QUICK_START.md) - Full document (10 min read)
2. Use the system for a few days
3. [README.md](README.md) - Sections: "Frontend Design" (15 min)

### Path 2: Developer - Maintain Existing System
**Goal**: Fix bugs and make small changes

1. [QUICK_START.md](QUICK_START.md) - Get running
2. [README.md](README.md) - Focus on:
   - File Structure (10 min)
   - How to Make Common Changes (20 min)
   - Troubleshooting (10 min)
3. [ARCHITECTURE.md](ARCHITECTURE.md) - Skim diagrams (15 min)
4. Explore code with documentation as reference

### Path 3: Developer - Improve ML Model
**Goal**: Increase prediction accuracy

1. [README.md](README.md) - Section: "Machine Learning System" (15 min)
2. [TECHNICAL.md](TECHNICAL.md) - Full document (45 min)
3. [ARCHITECTURE.md](ARCHITECTURE.md) - ML-specific flows (20 min)
4. Experiment with train-model.js

### Path 4: Developer - Add New Features
**Goal**: Extend system capabilities

1. [README.md](README.md) - Full document (60 min)
2. [ARCHITECTURE.md](ARCHITECTURE.md) - Understand component interactions (30 min)
3. [CHANGELOG.md](CHANGELOG.md) - Learn from past evolution (30 min)
4. Plan feature, implement, document

### Path 5: Researcher/Analyst
**Goal**: Understand the system academically

1. [CHANGELOG.md](CHANGELOG.md) - Understand motivation and evolution (30 min)
2. [TECHNICAL.md](TECHNICAL.md) - Deep dive into ML (60 min)
3. [README.md](README.md) - System details (45 min)
4. [ARCHITECTURE.md](ARCHITECTURE.md) - Visual verification (20 min)

---

## 🗂️ File Quick Reference

### Essential Files (Read First)
- `README.md` - Complete guide
- `QUICK_START.md` - 5-minute setup
- `package.json` - Dependencies

### Code Files
- `server.js` - HTTP server + ML predictions (250 lines)
- `collector.js` - Data collection + auto-retrain (257 lines)
- `train-model.js` - ML training pipeline (450 lines)
- `index.html` - Frontend (1,350 lines)

### Data Files
- `collected-alerts.json` - Raw alerts (12,803 alerts)
- `collected-waves.json` - Processed waves (98 waves)
- `model/*.json` - Trained ML model

### Documentation Files
- `TECHNICAL.md` - ML deep dive
- `ARCHITECTURE.md` - System diagrams
- `CHANGELOG.md` - Development history
- `DOCS_INDEX.md` - This file!

---

## 💡 Tips for Reading Documentation

1. **Start with goals**: Know what you want to accomplish
2. **Use Ctrl+F**: Search for keywords within documents
3. **Follow links**: Documents reference each other
4. **Try examples**: Code snippets are tested and working
5. **Ask questions**: Documentation can't cover everything
6. **Update docs**: Found something missing? Add it!

---

## 🔗 External Resources

### Machine Learning
- [TensorFlow.js Docs](https://www.tensorflow.org/js/guide)
- [Binary Classification Tutorial](https://developers.google.com/machine-learning/crash-course/classification)

### APIs & Data
- [Pikud HaOref Website](https://www.oref.org.il/)
- [Leaflet.js Docs](https://leafletjs.com/)

### Node.js
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [Express.js Guide](https://expressjs.com/en/guide/routing.html)

---

## 📞 Getting Help

1. **Check documentation** (you're here!)
2. **Look at code comments** - Inline explanations
3. **Check browser console** - JavaScript errors
4. **Read logs**:
   - Server: Terminal running `server.js`
   - Collector: `collector.log` or terminal
5. **Inspect data files**: `cat collected-alerts.json | jq`
6. **Review model metrics**: `cat model/metrics.json`

---

## ✅ Documentation Checklist

Before asking for help, make sure you've:

- [ ] Read [QUICK_START.md](QUICK_START.md)
- [ ] Checked [README.md](README.md) troubleshooting section
- [ ] Reviewed relevant section in [TECHNICAL.md](TECHNICAL.md) or [ARCHITECTURE.md](ARCHITECTURE.md)
- [ ] Checked browser console for errors
- [ ] Verified system is running (`ps aux | grep node`)
- [ ] Looked at recent logs
- [ ] Searched documentation for keywords

---

**Happy coding!** 🚀

The documentation is comprehensive but please update it when you make changes. Future developers (including future you) will thank you!

---

**Documentation Version**: 1.0  
**Last Updated**: March 9, 2026  
**Maintained By**: Project Team
