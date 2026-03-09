// Cloudflare Worker to relay Oref API requests (bypasses IP blocking)
// Deploy at: https://workers.cloudflare.com/

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function handleRequest(request) {
  const url = new URL(request.url);
  
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    if (url.pathname === '/history') {
      // Short-window AlertsHistory.json
      const orefUrl = 'https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json?' + Date.now();
      const response = await fetch(orefUrl, {
        headers: {
          'Referer': 'https://www.oref.org.il/',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      const data = await response.arrayBuffer();
      const text = new TextDecoder('utf-8').decode(data).replace(/^\uFEFF/, '');
      
      return new Response(text || '[]', {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }
      });
      
    } else if (url.pathname === '/full-history') {
      // Full GetAlarmsHistory with orange/red/green alerts
      const orefUrl = 'https://alerts-history.oref.org.il/Shared/Ajax/GetAlarmsHistory.aspx?lang=he&mode=1';
      const response = await fetch(orefUrl, {
        headers: {
          'Referer': 'https://alerts-history.oref.org.il/12481-he/Pakar.aspx',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      const data = await response.json();
      return new Response(JSON.stringify(data), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
      
    } else {
      return new Response('Oref API Relay - Endpoints: /history, /full-history', {
        headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' }
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
}

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});
