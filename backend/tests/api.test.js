const request = require('supertest');

const { connectTestDB, clearTestDB, disconnectTestDB } = require('./testUtils');
const createApp = require('../src/app');
const RelayWorker = require('../src/services/relayWorker');
const ConsumerWorker = require('../src/services/consumerWorker');
const { failureInjector } = require('../src/services/failureInjector');

jest.setTimeout(30000);

let app;
let relayWorker;
let consumerWorker;

async function waitUntil(predicate, { timeout = 5000, interval = 50 } = {}) {
  const deadline = Date.now() + timeout;
  // eslint-disable-next-line no-await-in-loop
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    if (await predicate()) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return predicate();
}

beforeAll(async () => {
  await connectTestDB();
  app = createApp();
  relayWorker = new RelayWorker(20);
  consumerWorker = new ConsumerWorker();
  relayWorker.start();
  consumerWorker.start();
});

afterEach(async () => {
  await clearTestDB();
});

afterAll(async () => {
  relayWorker.stop();
  consumerWorker.stop();
  await disconnectTestDB();
});

test('create account and get it back', async () => {
  const r = await request(app).post('/accounts').send({ name: 'Alice', opening_balance: 100 });
  expect(r.status).toBe(201);
  expect(r.body.balance).toBe(100);
  expect(r.body.version).toBe(0);

  const r2 = await request(app).get(`/accounts/${r.body.id}`);
  expect(r2.status).toBe(200);
  expect(r2.body.name).toBe('Alice');
});

test('Idempotency-Key prevents double apply', async () => {
  const acc = (await request(app).post('/accounts').send({ name: 'Bob', opening_balance: 100 })).body;
  const key = 'client-generated-key-123';
  const payload = { amount: 50, type: 'debit' };

  const r1 = await request(app).post(`/accounts/${acc.id}/transactions`).set('Idempotency-Key', key).send(payload);
  const r2 = await request(app).post(`/accounts/${acc.id}/transactions`).set('Idempotency-Key', key).send(payload);
  const r3 = await request(app).post(`/accounts/${acc.id}/transactions`).set('Idempotency-Key', key).send(payload);

  expect([r1.status, r2.status, r3.status]).toEqual([200, 200, 200]);

  expect(r1.body.idempotent_replay).toBe(false);
  expect(r2.body.idempotent_replay).toBe(true);
  expect(r3.body.idempotent_replay).toBe(true);

  // Same event_id and balance returned every time -- the client cannot
  // tell it was "retried" except for the idempotent_replay flag.
  expect(r1.body.event_id).toBe(r2.body.event_id);
  expect(r1.body.event_id).toBe(r3.body.event_id);
  expect([r1.body.balance, r2.body.balance, r3.body.balance]).toEqual([50, 50, 50]);

  const final = (await request(app).get(`/accounts/${acc.id}`)).body;
  expect(final.balance).toBe(50); // debited exactly once, not three times
});

test('reusing an Idempotency-Key with a different body is rejected', async () => {
  const acc = (await request(app).post('/accounts').send({ name: 'Carol', opening_balance: 100 })).body;
  const key = 'reused-key';

  const r1 = await request(app)
    .post(`/accounts/${acc.id}/transactions`)
    .set('Idempotency-Key', key)
    .send({ amount: 10, type: 'credit' });
  expect(r1.status).toBe(200);

  const r2 = await request(app)
    .post(`/accounts/${acc.id}/transactions`)
    .set('Idempotency-Key', key)
    .send({ amount: 999, type: 'debit' });
  expect(r2.status).toBe(422);
});

test('insufficient funds are rejected and leave the balance unchanged', async () => {
  const acc = (await request(app).post('/accounts').send({ name: 'Dave', opening_balance: 10 })).body;
  const r = await request(app).post(`/accounts/${acc.id}/transactions`).send({ amount: 50, type: 'debit' });
  expect(r.status).toBe(400);

  const final = (await request(app).get(`/accounts/${acc.id}`)).body;
  expect(final.balance).toBe(10);
});

test('concurrent transactions on one account produce zero lost updates', async () => {
  const acc = (await request(app).post('/accounts').send({ name: 'Erin', opening_balance: 1000 })).body;
  const accountId = acc.id;

  const nCredits = 25;
  const nDebits = 15;
  const creditAmount = 4.0;
  const debitAmount = 3.0;

  const jobs = [];
  for (let i = 0; i < nCredits; i += 1) {
    jobs.push(request(app).post(`/accounts/${accountId}/transactions`).send({ amount: creditAmount, type: 'credit' }));
  }
  for (let i = 0; i < nDebits; i += 1) {
    jobs.push(request(app).post(`/accounts/${accountId}/transactions`).send({ amount: debitAmount, type: 'debit' }));
  }

  const results = await Promise.all(jobs);
  results.forEach((r) => expect(r.status).toBe(200));

  const expected = 1000 + nCredits * creditAmount - nDebits * debitAmount;
  const final = (await request(app).get(`/accounts/${accountId}`)).body;
  expect(final.balance).toBeCloseTo(expected, 5);
  // version must have advanced exactly once per successful transaction --
  // if updates were lost, version would be lower than nCredits + nDebits.
  expect(final.version).toBe(nCredits + nDebits);
});

test('full outbox -> relay -> consumer -> audit-log pipeline works end to end', async () => {
  const acc = (await request(app).post('/accounts').send({ name: 'Frank', opening_balance: 0 })).body;
  const accountId = acc.id;

  const r = await request(app).post(`/accounts/${accountId}/transactions`).send({ amount: 20, type: 'credit' });
  expect(r.status).toBe(200);
  const eventId = r.body.event_id;

  // The outbox -> relay -> consumer pipeline runs on background timers;
  // give it a moment to catch up, bounded by a timeout so a real bug
  // fails the test instead of hanging forever.
  const ok = await waitUntil(async () => {
    const log = (await request(app).get(`/accounts/${accountId}/audit-log`)).body;
    return log.some((e) => e.event_id === eventId);
  });
  expect(ok).toBe(true);

  const metrics = (await request(app).get('/metrics')).body;
  expect(metrics.outbox_unpublished).toBe(0);
  expect(metrics.processed_events).toBeGreaterThanOrEqual(1);
});

test('DLQ + replay works over the real HTTP API', async () => {
  const acc = (await request(app).post('/accounts').send({ name: 'Grace', opening_balance: 0 })).body;
  const accountId = acc.id;

  // simulate_failures forces the consumer to fail on every attempt until
  // retries are exhausted, landing the event in the DLQ.
  const r = await request(app)
    .post(`/accounts/${accountId}/transactions`)
    .send({ amount: 15, type: 'credit', simulate_failures: 99 });
  const eventId = r.body.event_id;

  const ok = await waitUntil(async () => {
    const dlq = (await request(app).get('/dlq')).body;
    return dlq.some((d) => d.event_id === eventId);
  });
  expect(ok).toBe(true);

  const dlq = (await request(app).get('/dlq')).body;
  const entry = dlq.find((d) => d.event_id === eventId);

  // "Fix" the downstream issue before replaying, same as in the chaos tests.
  failureInjector.disarm(eventId);
  const replay = await request(app).post(`/dlq/${entry.id}/replay`);
  expect(replay.status).toBe(200);
  expect(replay.body.status).toBe('applied');

  const ok2 = await waitUntil(async () => {
    const log = (await request(app).get(`/accounts/${accountId}/audit-log`)).body;
    return log.some((e) => e.event_id === eventId);
  });
  expect(ok2).toBe(true);
});

test('concurrent requests with the same Idempotency-Key apply exactly once', async () => {
  const acc = (await request(app).post('/accounts').send({ name: 'Zed', opening_balance: 100 })).body;
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      request(app)
        .post(`/accounts/${acc.id}/transactions`)
        .set('Idempotency-Key', 'same-key-concurrent')
        .send({ amount: 10, type: 'debit' })
    )
  );
  results.forEach((r) => expect(r.status).toBe(200));
  expect(new Set(results.map((r) => r.body.event_id)).size).toBe(1);
  expect(results.filter((r) => r.body.idempotent_replay === false)).toHaveLength(1);
  expect((await request(app).get(`/accounts/${acc.id}`)).body.balance).toBe(90);
});

test('malformed JSON body returns 400, not 500', async () => {
  const r = await request(app).post('/accounts').set('Content-Type', 'application/json').send('{bad json');
  expect(r.status).toBe(400);
});

test('audit log records the balance right after each event', async () => {
  const acc = (await request(app).post('/accounts').send({ name: 'Yan', opening_balance: 0 })).body;
  await request(app).post(`/accounts/${acc.id}/transactions`).send({ amount: 10, type: 'credit' });
  await request(app).post(`/accounts/${acc.id}/transactions`).send({ amount: 5, type: 'credit' });
  const ok = await waitUntil(async () => (await request(app).get(`/accounts/${acc.id}/audit-log`)).body.length === 2);
  expect(ok).toBe(true);
  const log = (await request(app).get(`/accounts/${acc.id}/audit-log`)).body;
  expect(log.map((e) => e.balance_after_event)).toEqual([10, 15]);
});
