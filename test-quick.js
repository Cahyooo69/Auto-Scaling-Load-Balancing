// Quick sanity test script: sends 20 concurrent checkout requests to the Load Balancer
const http = require('http');

const TARGET_URL = process.env.TARGET_URL || 'http://localhost/tickets/buy';

async function sendBuyRequest(id) {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.request(
      TARGET_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          const duration = Date.now() - start;
          try {
            const json = JSON.parse(data);
            resolve({ id, status: res.statusCode, duration, body: json });
          } catch (e) {
            resolve({ id, status: res.statusCode, duration, raw: data });
          }
        });
      }
    );

    req.on('error', (err) => {
      resolve({ id, status: 'ERROR', duration: Date.now() - start, error: err.message });
    });

    req.write(JSON.stringify({ userId: `quick_user_${id}` }));
    req.end();
  });
}

async function run() {
  console.log(`Sending 20 concurrent checkout requests to ${TARGET_URL}...`);
  const promises = Array.from({ length: 20 }, (_, i) => sendBuyRequest(i + 1));
  const results = await Promise.all(promises);

  console.table(
    results.map((r) => ({
      ID: r.id,
      Status: r.status,
      Latency: `${r.duration}ms`,
      ServedBy: r.body?.servedBy || 'N/A',
      Remaining: r.body?.remainingStock ?? 'N/A',
      Success: r.body?.success ?? false,
      Info: r.error || (r.body?.message ?? 'OK'),
    }))
  );

  const hostCounts = results.reduce((acc, r) => {
    const host = r.body?.servedBy || 'Unknown';
    acc[host] = (acc[host] || 0) + 1;
    return acc;
  }, {});

  console.log('\n--- Load Balancing Distribution Across Containers ---');
  console.table(hostCounts);
}

run();
