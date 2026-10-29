/**
 * Lightweight load test (no extra dependencies beyond axios).
 *
 * Usage:
 *   npm start &
 *   npm run loadtest -- --requests 500 --concurrency 20
 */
const axios = require('axios');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { baseUrl: 'http://127.0.0.1:8000', requests: 300, concurrency: 20 };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--base-url') opts.baseUrl = args[(i += 1)];
    else if (args[i] === '--requests') opts.requests = parseInt(args[(i += 1)], 10);
    else if (args[i] === '--concurrency') opts.concurrency = parseInt(args[(i += 1)], 10);
  }
  return opts;
}

async function run({ baseUrl, requests: totalRequests, concurrency }) {
  const client = axios.create({ baseURL: baseUrl, timeout: 10000, validateStatus: () => true });
  const account = (await client.post('/accounts', { name: 'Load Test', opening_balance: 1000000 })).data;
  const accountId = account.id;

  const latencies = [];
  let errors = 0;
  let nextIndex = 0;

  async function worker() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= totalRequests) return;
      const t0 = process.hrtime.bigint();
      let ok = true;
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await client.post(`/accounts/${accountId}/transactions`, {
          amount: 1,
          type: i % 2 === 0 ? 'credit' : 'debit',
        });
        ok = r.status === 200;
      } catch (e) {
        ok = false;
      }
      const dtMs = Number(process.hrtime.bigint() - t0) / 1e6;
      latencies.push(dtMs);
      if (!ok) errors += 1;
    }
  }

  const start = Date.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const elapsedSeconds = (Date.now() - start) / 1000;

  latencies.sort((a, b) => a - b);
  const pct = (p) => latencies[Math.min(Math.floor(latencies.length * p), latencies.length - 1)];

  console.log(`Requests:        ${totalRequests}`);
  console.log(`Concurrency:     ${concurrency}`);
  console.log(`Elapsed:         ${elapsedSeconds.toFixed(2)}s`);
  console.log(`Throughput:      ${(totalRequests / elapsedSeconds).toFixed(1)} req/s`);
  console.log(`Errors:          ${errors}`);
  console.log(`Latency p50/p95/p99 (ms): ${pct(0.5).toFixed(1)} / ${pct(0.95).toFixed(1)} / ${pct(0.99).toFixed(1)}`);
  console.log(`Latency mean (ms):        ${(latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1)}`);

  const final = (await client.get(`/accounts/${accountId}`)).data;
  console.log(`\nFinal balance: ${final.balance} (verifies no lost updates under load)`);
  console.log(`Final version: ${final.version} (should equal successful request count)`);
}

run(parseArgs()).catch((err) => {
  console.error(err);
  process.exit(1);
});
