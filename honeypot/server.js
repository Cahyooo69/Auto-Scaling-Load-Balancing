const http = require('http');

const PORT = parseInt(process.env.HONEYPOT_PORT || '8081', 10);
const MAX_EVENTS = 200;

function createHoneypotState() {
  const events = [];
  const hitCounts = new Map();
  let totalHits = 0;

  function record(entry) {
    totalHits += 1;
    const key = `${entry.method}|${entry.path}`;
    hitCounts.set(key, (hitCounts.get(key) || 0) + 1);
    events.unshift(entry);
    if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
    console.log(JSON.stringify({ type: 'HONEYPOT_INTRUSION', ...entry }));
  }

  function renderPrometheusMetrics() {
    const lines = [
      '# HELP wartiket_honeypot_hits_total Total intrusion probes trapped by the Honeypot',
      '# TYPE wartiket_honeypot_hits_total counter',
      `wartiket_honeypot_hits_total{path="ALL",method="ALL"} ${totalHits}`,
    ];
    for (const [key, count] of hitCounts.entries()) {
      const [method, path] = key.split('|');
      const safePath = path.replace(/"/g, '\\"');
      lines.push(`wartiket_honeypot_hits_total{path="${safePath}",method="${method}"} ${count}`);
    }
    return `${lines.join('\n')}\n`;
  }

  function handler(req, res) {
    const rawUrl = req.headers['x-original-uri'] || req.url || '/';
    const urlPath = rawUrl.split('?')[0];

    // Internal-only observability endpoints (never exposed through WAF decoy rules)
    if (urlPath === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'UP', service: 'wartiket-honeypot', totalHits }));
    }
    if (urlPath === '/metrics') {
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
      return res.end(renderPrometheusMetrics());
    }
    if (urlPath === '/internal/events') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ totalHits, recentEvents: events.slice(0, 50) }));
    }

    let body = '';
    req.on('data', (chunk) => {
      if (body.length < 1024) body += chunk.toString('utf8');
    });
    req.on('end', () => {
      const clientIp = req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
      record({
        timestamp: new Date().toISOString(),
        ip: String(clientIp).split(',')[0].trim(),
        method: req.method || 'GET',
        path: urlPath,
        userAgent: String(req.headers['user-agent'] || '').slice(0, 160),
        payloadSnippet: body.slice(0, 200),
      });

      if (urlPath.includes('.env') || urlPath.includes('config.php')) {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Honeypot-Canary': 'true' });
        return res.end('APP_ENV=staging\nDB_HOST=10.255.0.99\nDB_USER=decoy_admin\nCANARY_KEY=HP-WARTIKET-TRAP-2026\n');
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Honeypot-Canary': 'true' });
      return res.end(
        '<!doctype html><html><head><title>Admin Login</title></head><body>' +
        '<h2>Restricted System Panel</h2>' +
        '<form method="POST"><input name="user" placeholder="Username"/><input name="pass" type="password" placeholder="Password"/>' +
        '<button type="submit">Sign In</button></form></body></html>'
      );
    });
  }

  return { handler, getStats: () => ({ totalHits, events }) };
}

if (require.main === module) {
  const { handler } = createHoneypotState();
  http.createServer(handler).listen(PORT, () => {
    console.log(`[Honeypot] Intrusion trap listening internally on port ${PORT}`);
  });
}

module.exports = { createHoneypotState };
