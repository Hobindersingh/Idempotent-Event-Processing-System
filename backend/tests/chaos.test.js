/**
 * These tests exercise src/services/consumer.js directly (not through
 * HTTP or the background workers) so failure scenarios are deterministic
 * instead of timing-dependent: we get to control exactly when a
 * "duplicate delivery" or "out-of-order event" happens.
 */
const { v4: uuidv4 } = require('uuid');

const { connectTestDB, clearTestDB, disconnectTestDB } = require('./testUtils');
const Account = require('../src/models/Account');
const AuditLog = require('../src/models/AuditLog');
const ProcessedEvent = require('../src/models/ProcessedEvent');
const DeadLetter = require('../src/models/DeadLetter');
const ConsumerState = require('../src/models/ConsumerState');
const { processEvent, replayDeadLetter } = require('../src/services/consumer');
const { failureInjector } = require('../src/services/failureInjector');

jest.setTimeout(30000);

function makeEvent(accountId, sequence, { amount = 10.0, eventType = 'transaction.credit', eventId } = {}) {
  return { eventId: eventId || uuidv4(), accountId, eventType, amount, sequence };
}

async function makeAccount({ name = 'Test Account', balance = 0.0 } = {}) {
  return Account.create({ _id: uuidv4(), name, balance, version: 0, lastSequence: 0 });
}

beforeAll(connectTestDB);
afterEach(clearTestDB);
afterAll(disconnectTestDB);

test('duplicate delivery is applied exactly once', async () => {
  const account = await makeAccount({ balance: 0.0 });
  const event = makeEvent(account._id, 1, { amount: 25.0 });

  const first = await processEvent(event);
  const second = await processEvent({ ...event });
  const third = await processEvent({ ...event });

  expect(first.status).toBe('applied');
  expect(second.status).toBe('duplicate');
  expect(third.status).toBe('duplicate');

  const entries = await AuditLog.find({ eventId: event.eventId });
  expect(entries).toHaveLength(1);
  expect(await ProcessedEvent.countDocuments({ _id: event.eventId })).toBe(1);
});

test('out-of-order events are dropped, not misapplied', async () => {
  const account = await makeAccount({ balance: 0.0 });

  const eSeq1 = makeEvent(account._id, 1, { amount: 10.0 });
  const eSeq3 = makeEvent(account._id, 3, { amount: 30.0 });
  const eSeq2Late = makeEvent(account._id, 2, { amount: 20.0 }); // arrives AFTER seq 3

  const r1 = await processEvent(eSeq1);
  const r3 = await processEvent(eSeq3);
  const r2Late = await processEvent(eSeq2Late);

  expect(r1.status).toBe('applied');
  expect(r3.status).toBe('applied');
  expect(r2Late.status).toBe('stale');

  const rows = await AuditLog.find({ accountId: account._id });
  const appliedIds = new Set(rows.map((row) => row.eventId));
  expect(appliedIds).toEqual(new Set([eSeq1.eventId, eSeq3.eventId]));

  const state = await ConsumerState.findById(account._id);
  expect(state.lastAppliedSequence).toBe(3);

  // The stale event is still recorded as "processed" so a redelivery of
  // IT is also a safe no-op, not a repeated attempt to apply it.
  const redelivered = await processEvent({ ...eSeq2Late });
  expect(redelivered.status).toBe('duplicate');
});

test('transient failure recovers via retry', async () => {
  const account = await makeAccount({ balance: 0.0 });
  const event = makeEvent(account._id, 1, { amount: 15.0 });
  failureInjector.arm(event.eventId, 2); // fail twice, succeed on the 3rd attempt

  const result = await processEvent(event, { maxRetries: 3, baseBackoffMs: 1 });

  expect(result.status).toBe('applied');
  expect(await AuditLog.countDocuments({ eventId: event.eventId })).toBe(1);
  expect(await DeadLetter.countDocuments()).toBe(0);
});

test('persistent failure is dead-lettered, not lost', async () => {
  const account = await makeAccount({ balance: 0.0 });
  const event = makeEvent(account._id, 1, { amount: 50.0 });
  failureInjector.arm(event.eventId, 99); // always fails

  const result = await processEvent(event, { maxRetries: 2, baseBackoffMs: 1 });

  expect(result.status).toBe('dead_lettered');
  expect(await AuditLog.countDocuments({ eventId: event.eventId })).toBe(0);

  const dl = await DeadLetter.findOne({ eventId: event.eventId });
  expect(dl.attempts).toBe(3); // initial attempt + 2 retries
  expect(dl.resolved).toBe(false);
});

test('dead letter replay succeeds after the underlying issue is fixed', async () => {
  const account = await makeAccount({ balance: 0.0 });
  const event = makeEvent(account._id, 1, { amount: 40.0 });
  failureInjector.arm(event.eventId, 99);

  const result = await processEvent(event, { maxRetries: 1, baseBackoffMs: 1 });
  expect(result.status).toBe('dead_lettered');

  const dl = await DeadLetter.findOne({ eventId: event.eventId });

  failureInjector.disarm(event.eventId);
  const replayResult = await replayDeadLetter(dl._id);

  expect(replayResult.status).toBe('applied');
  const refreshed = await DeadLetter.findById(dl._id);
  expect(refreshed.resolved).toBe(true);
  expect(await AuditLog.countDocuments({ eventId: event.eventId })).toBe(1);

  // Replaying an already-resolved dead letter again is a safe no-op.
  const replayAgain = await replayDeadLetter(dl._id);
  expect(replayAgain.status).toBe('duplicate');
});

test('events for different accounts are independent', async () => {
  const a1 = await makeAccount({ name: 'A1' });
  const a2 = await makeAccount({ name: 'A2' });

  const e1 = makeEvent(a1._id, 1, { amount: 5.0 });
  const e2 = makeEvent(a2._id, 1, { amount: 5.0 }); // same sequence, different account

  const r1 = await processEvent(e1);
  const r2 = await processEvent(e2);

  expect(r1.status).toBe('applied');
  expect(r2.status).toBe('applied');
  expect((await ConsumerState.findById(a1._id)).lastAppliedSequence).toBe(1);
  expect((await ConsumerState.findById(a2._id)).lastAppliedSequence).toBe(1);
});
