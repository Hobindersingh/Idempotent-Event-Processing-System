/**
 * Consumer-side processing logic.
 *
 * Kept as plain, exported async functions (no threads, no queue coupling)
 * so it can be:
 *   1. driven by ConsumerWorker against messages coming off the broker, and
 *   2. called directly and deterministically from tests to simulate
 *      duplicate delivery, out-of-order delivery, and transient failures
 *      without relying on timing.
 *
 * This module is the heart of "effectively-once" processing:
 *   - ProcessedEvent primary key (_id = event_id)  -> dedup: a redelivered
 *     event is a safe no-op.
 *   - ConsumerState.lastAppliedSequence             -> stale/out-of-order
 *     events are dropped, not misapplied.
 *   - retryWithBackoff + DeadLetter                 -> transient failures
 *     are retried, then quarantined instead of being silently lost or
 *     retried forever.
 *
 * Every "apply the event" + "mark it processed" pair happens inside a
 * single MongoDB transaction, so a crash between the two can never happen
 * -- either both land, or neither does.
 */
const mongoose = require('mongoose');

const Account = require('../models/Account');
const ProcessedEvent = require('../models/ProcessedEvent');
const ConsumerState = require('../models/ConsumerState');
const AuditLog = require('../models/AuditLog');
const DeadLetter = require('../models/DeadLetter');
const { failureInjector, TransientProcessingError } = require('./failureInjector');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientTransactionError(err) {
  return Boolean(err && err.errorLabels && err.errorLabels.includes('TransientTransactionError'));
}

/**
 * Actually project the event into the downstream audit log. Assumes the
 * caller will insert the ProcessedEvent dedup row in the same transaction.
 */
async function _applyEvent(session, event) {
  failureInjector.maybeFail(event.eventId);

  let state = await ConsumerState.findById(event.accountId).session(session);
  if (!state) {
    [state] = await ConsumerState.create([{ _id: event.accountId, lastAppliedSequence: 0 }], { session });
  }

  if (event.sequence <= state.lastAppliedSequence) {
    // Out-of-order / stale event for this account: a newer sequence was
    // already applied, so applying this one would corrupt the projection.
    // It's still recorded as "processed" by the caller (so redelivery of
    // IT is also a no-op), but the audit log itself is left untouched.
    return {
      status: 'stale',
      eventId: event.eventId,
      detail: `seq ${event.sequence} <= last_applied ${state.lastAppliedSequence}`,
    };
  }

  const account = await Account.findById(event.accountId).session(session);
  await AuditLog.create(
    [
      {
        eventId: event.eventId,
        accountId: event.accountId,
        eventType: event.eventType,
        amount: event.amount,
        sequence: event.sequence,
        // Prefer the balance captured in the event itself; fall back to the
        // account's current balance only for legacy events without one.
        balanceAfterEvent:
          typeof event.balance === 'number' ? event.balance : account ? account.balance : 0,
      },
    ],
    { session }
  );

  state.lastAppliedSequence = event.sequence;
  await state.save({ session });

  return { status: 'applied', eventId: event.eventId };
}

/**
 * Process one event with:
 *   - dedup via the ProcessedEvent primary key (event_id)
 *   - retry with exponential backoff + jitter on TransientProcessingError
 *   - dead-lettering once max_retries is exhausted
 *
 * `event` is a plain object: { eventId, accountId, eventType, amount, sequence }
 */
async function processEvent(event, { maxRetries = 3, baseBackoffMs = 10 } = {}) {
  // Fast-path dedup check: if we've already recorded this event_id as
  // processed, this is a redelivery. Return immediately, no side effects.
  const already = await ProcessedEvent.findById(event.eventId);
  if (already) {
    return { status: 'duplicate', eventId: event.eventId };
  }

  let attempt = 0;
  let conflicts = 0;
  let lastError = null;
  const MAX_CONFLICT_RETRIES = 50;

  while (attempt <= maxRetries) {
    // eslint-disable-next-line no-await-in-loop
    const session = await mongoose.startSession();
    let committed = false;
    try {
      session.startTransaction();

      // eslint-disable-next-line no-await-in-loop
      const result = await _applyEvent(session, event);

      // Record the dedup marker in the SAME transaction as the effect.
      // eslint-disable-next-line no-await-in-loop
      await ProcessedEvent.create(
        [{ _id: event.eventId, accountId: event.accountId, result: { status: result.status } }],
        { session }
      );

      // eslint-disable-next-line no-await-in-loop
      await session.commitTransaction();
      committed = true;
      return result;
    } catch (err) {
      if (!committed) {
        // eslint-disable-next-line no-await-in-loop
        await session.abortTransaction().catch(() => {});
      }

      if (err && err.code === 11000) {
        // Another worker already recorded this event_id (dedup race) -- fine.
        return { status: 'duplicate', eventId: event.eventId };
      }

      if (isTransientTransactionError(err) && conflicts < MAX_CONFLICT_RETRIES) {
        // Storage-engine write conflict between two transactions: retry.
        conflicts += 1;
        // eslint-disable-next-line no-await-in-loop
        await sleep(Math.random() * baseBackoffMs * Math.min(conflicts, 10));
        continue;
      }

      // Any other failure (injected, DB hiccup, bug) is retried with
      // exponential backoff and, once the budget is spent, dead-lettered --
      // never silently dropped.
      lastError = err;
      attempt += 1;
      if (attempt > maxRetries) break;
      const backoff = baseBackoffMs * 2 ** (attempt - 1) + Math.random() * baseBackoffMs;
      // eslint-disable-next-line no-await-in-loop
      await sleep(backoff);
    } finally {
      // eslint-disable-next-line no-await-in-loop
      await session.endSession();
    }
  }

  // Retries exhausted: quarantine. Upsert by eventId so a failed replay
  // updates the existing entry instead of creating duplicate DLQ rows.
  const errorMessage = lastError ? lastError.message : 'unknown error';
  await DeadLetter.findOneAndUpdate(
    { eventId: event.eventId, resolved: false },
    { $set: { accountId: event.accountId, payload: event, error: errorMessage, attempts: attempt } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return { status: 'dead_lettered', eventId: event.eventId, detail: errorMessage };
}

/**
 * Manually re-run a quarantined event (e.g. after fixing whatever made it
 * fail). Uses the same idempotent processEvent path, so replaying an event
 * that somehow already succeeded elsewhere is still perfectly safe.
 */
async function replayDeadLetter(deadLetterId, { maxRetries = 3 } = {}) {
  const dl = await DeadLetter.findById(deadLetterId);
  if (!dl) {
    const err = new Error(`no dead letter with id ${deadLetterId}`);
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (dl.resolved) {
    return { status: 'duplicate', eventId: dl.eventId, detail: 'already resolved' };
  }

  const result = await processEvent(dl.payload, { maxRetries });
  if (['applied', 'duplicate', 'stale'].includes(result.status)) {
    dl.resolved = true;
    await dl.save();
  }
  return result;
}

module.exports = { processEvent, replayDeadLetter };
