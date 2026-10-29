/**
 * Run this against a live server (`npm start`) to watch the idempotency
 * guarantees in action.
 *
 * Usage:
 *   npm start &
 *   npm run demo
 */
const axios = require('axios');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8000';
const client = axios.create({ baseURL: BASE, timeout: 10000 });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('1. Creating account with $100 opening balance...');
  const acc = (await client.post('/accounts', { name: 'Demo User', opening_balance: 100 })).data;
  console.log(`   account_id=${acc.id} balance=${acc.balance}\n`);

  console.log('2. Sending the SAME debit request 5 times with the same Idempotency-Key');
  console.log('   (simulating a flaky network causing client retries)...');
  const key = 'demo-key-abc';
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = (
      await client.post(
        `/accounts/${acc.id}/transactions`,
        { amount: 25, type: 'debit' },
        { headers: { 'Idempotency-Key': key } }
      )
    ).data;
    console.log(`   attempt ${i + 1}: balance=${r.balance} replay=${r.idempotent_replay}`);
  }

  const final = (await client.get(`/accounts/${acc.id}`)).data;
  console.log(`\n   Final balance: ${final.balance} (expected 75 -- debited exactly once)\n`);

  console.log('3. Forcing a transaction to fail 5 times in a row (more than the');
  console.log("   consumer's retry budget of 3), so it lands in the DLQ instead");
  console.log('   of being lost or retried forever...');
  await client.post(`/accounts/${acc.id}/transactions`, { amount: 10, type: 'credit', simulate_failures: 5 });
  await sleep(1500);
  const dlq = (await client.get('/dlq')).data;
  console.log(`   DLQ entries: ${JSON.stringify(dlq)}\n`);

  if (dlq.length > 0) {
    const entryId = dlq[0].id;
    console.log(`4. Replaying dead letter ${entryId} (only 1 simulated failure left,`);
    console.log('   well within the retry budget, so this replay succeeds)...');
    const replay = (await client.post(`/dlq/${entryId}/replay`)).data;
    console.log(`   replay result: ${JSON.stringify(replay)}\n`);
  }

  console.log('5. Metrics snapshot:');
  console.log('  ', (await client.get('/metrics')).data);
}

main().catch((err) => {
  console.error(err.response ? err.response.data : err);
  process.exit(1);
});
