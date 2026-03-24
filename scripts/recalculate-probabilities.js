const fs = require('fs');
const http = require('http');
const cities = require('../pikud-haoref-api/cities.json');

const nameToCity = {};
cities.forEach(c => { nameToCity[c.name] = c; });

async function recalculateAll() {
  console.log('Loading collected-alerts.json...');
  const alertsObj = JSON.parse(fs.readFileSync('data/collected-alerts.json', 'utf-8'));
  const alerts = Object.values(alertsObj).filter(a => a.alertDate);
  
  console.log('Total alerts:', alerts.length);
  
  // Group into waves
  const sorted = alerts.sort((a, b) => (a.alertDate || '').localeCompare(b.alertDate || ''));
  const waves = [];
  let currentWave = { startTime: null, alerts: [] };
  
  for (const alert of sorted) {
    const alertTime = new Date(alert.alertDate).getTime();
    if (isNaN(alertTime)) continue;
    
    if (!currentWave.startTime) {
      currentWave.startTime = alertTime;
      currentWave.alerts.push(alert);
    } else if (alertTime - currentWave.startTime < 3 * 60 * 1000) {
      currentWave.alerts.push(alert);
    } else {
      if (currentWave.alerts.length > 0) waves.push(currentWave);
      currentWave = { startTime: alertTime, alerts: [alert] };
    }
  }
  if (currentWave.alerts.length > 0) waves.push(currentWave);
  
  console.log('Total waves:', waves.length);
  console.log('Processing...\n');
  
  let processed = 0;
  let updated = 0;
  
  for (const wave of waves) {
    const orangeAlerts = wave.alerts.filter(a => (a.title || '').includes('בדקות הקרובות'));
    
    if (orangeAlerts.length === 0) continue;
    
    const orangeCities = [...new Set(orangeAlerts.map(a => a.data))];
    const coords = orangeCities.map(n => nameToCity[n]).filter(c => c && c.lat != null);
    if (coords.length < 3) continue;
    
    const centerLat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
    const centerLng = coords.reduce((s, c) => s + c.lng, 0) / coords.length;
    
    // Find associated red alerts (within 15 min) for multi-missile detection
    const waveStartMs = wave.startTime;
    const redAlerts = alerts.filter(a => {
      if (!(a.title || '').includes('ירי רקטות')) return false;
      const t = new Date(a.alertDate).getTime();
      return t >= waveStartMs && t < waveStartMs + 15 * 60 * 1000;
    });
    const redCitiesForClustering = [...new Set(redAlerts.map(a => a.data))];
    
    const payload = JSON.stringify({
      cities: orangeCities,
      orangeCities: orangeCities,
      redCities: [], // Keep empty for no red feedback
      redCitiesForClustering: redCitiesForClustering, // Pass for multi-missile detection
      centerLat,
      centerLng,
      zoneSize: orangeCities.length,
      timeElapsedMinutes: 0
    });
    
    try {
      const predResponse = await new Promise((resolve, reject) => {
        const options = {
          hostname: 'localhost',
          port: 3000,
          path: '/api/predict',
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json', 
            'Content-Length': Buffer.byteLength(payload) 
          }
        };
        
        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            try { 
              resolve(JSON.parse(data)); 
            } catch (e) { 
              reject(new Error('Parse error: ' + data.substring(0, 100))); 
            }
          });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
      });
      
      // Update probabilities for ALL orange alerts in wave
      for (const alert of orangeAlerts) {
        const pred = predResponse.predictions && predResponse.predictions[alert.data];
        if (pred && pred.prob != null) {
          alert.probability = pred.prob;
          updated++;
        }
      }
      
      processed++;
      if (processed % 20 === 0) {
        console.log('Processed', processed, 'waves, updated', updated, 'alerts');
      }
    } catch (e) {
      console.error('Error processing wave:', e.message);
    }
  }
  
  console.log('\n✓ Processed', processed, 'waves');
  console.log('✓ Updated', updated, 'alert probabilities');
  console.log('\nWriting to file...');
  
  // Write back - preserve original object structure
  fs.writeFileSync('data/collected-alerts.json', JSON.stringify(alertsObj, null, 2));
  
  console.log('✓ Done! File updated.');
  
  // Verify
  const verify = JSON.parse(fs.readFileSync('data/collected-alerts.json', 'utf-8'));
  const withProb = Object.values(verify).filter(a => a.probability != null).length;
  console.log('\nVerification:', withProb, 'alerts now have probabilities');
}

recalculateAll().catch(console.error);
