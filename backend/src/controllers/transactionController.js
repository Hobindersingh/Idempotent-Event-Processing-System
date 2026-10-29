/**
 * POST /accounts/:accountId/transactions
 *
 *  - Honors an `Idempotency-Key` header the way Stripe's API does: the
 *    first request with a given key executes; every subsequent request
 *    with the same key (even after a crash/retry) gets back the exact
 *    same response without being applied twice.
 *  - Uses optimistic concurrency control on `accounts.version` so
 *    concurrent transactions on the SAME account never lose an update.
 *  - Writes the balance change, the outbox event AND the idempotency
 *    "claim" in ONE MongoDB transaction, so the event can never be dropped
 *    and two concurrent requests with the same key can never both apply.
 */
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const Account = require('../models/Account');
const Outbox = require('../models/Outbox');
const IdempotencyCache = require('../models/IdempotencyCache');
const { computeFingerprint } = require('../utils/fingerprint');
const { failureInjector } = require('../services/failureInjector');

const MAX_OCC_RETRIES = 60;
const ENDPOINT = 'POST /accounts/:id/transactions';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientTransactionError(err) {
  return Boolean(err && err.errorLabels && err.errorLabels.includes('TransientTransactionError'));
}

function replayResponse(res, cacheEntry) {
  const replay = JSON.parse(cacheEntry.responseBody);
  replay.idempotent_replay = true;
  return res.status(200).json(replay);
}

/** Atomic "create pending row if absent, else return the existing one". */
async function getOrCreateCacheEntry(key, fingerprint) {
  const doOnce = () =>
    IdempotencyCache.findOneAndUpdate(
      { _id: key },
      { $setOnInsert: { endpoint: ENDPOINT, requestFingerprint: fingerprint, status: 'pending' } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  try {
    return await doOnce();
  } catch (err) {
    // Two requests upserting the same brand-new _id at the same instant:
    // MongoDB can raise E11000 for the loser. The row now exists, so read it.
    if (err && err.code === 11000) {
      return IdempotencyCache.findById(key);
    }
    throw err;
  }
}

async function createTransaction(req, res, next) {
  try {
    const { accountId } = req.params;
    const { amount, type, simulate_failures: simulateFailures } = req.body || {};

    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return res.status(422).json({ detail: 'amount must be a positive number' });
    }
    if (type !== 'credit' && type !== 'debit') {
      return res.status(422).json({ detail: "type must be 'credit' or 'debit'" });
    }
    if (
      simulateFailures !== undefined &&
      (typeof simulateFailures !== 'number' || simulateFailures < 0 || simulateFailures > 1000)
    ) {
      return res.status(422).json({ detail: 'simulate_failures must be between 0 and 1000' });
    }

    const idempotencyKey = req.get('Idempotency-Key') || null;
    if (idempotencyKey && idempotencyKey.length > 255) {
      return res.status(422).json({ detail: 'Idempotency-Key must be at most 255 characters' });
    }
    const fingerprint = computeFingerprint(accountId, amount, type);

    if (idempotencyKey) {
      const cacheEntry = await getOrCreateCacheEntry(idempotencyKey, fingerprint);
      if (cacheEntry.requestFingerprint !== fingerprint) {
        return res.status(422).json({
          detail: 'Idempotency-Key was already used with a different request body',
        });
      }
      if (cacheEntry.status === 'completed') {
        return replayResponse(res, cacheEntry);
      }
      // status === 'pending': first execution, or a concurrent duplicate.
      // The claim step INSIDE the transaction below settles who wins.
    }

    for (let attempt = 0; attempt < MAX_OCC_RETRIES; attempt += 1) {
      // On every retry, a concurrent request with the same key may have
      // finished in the meantime -- if so, replay its response.
      if (idempotencyKey && attempt > 0) {
        // eslint-disable-next-line no-await-in-loop
        const fresh = await IdempotencyCache.findById(idempotencyKey);
        if (fresh && fresh.status === 'completed') return replayResponse(res, fresh);
      }

      // eslint-disable-next-line no-await-in-loop
      const account = await Account.findById(accountId);
      if (!account) {
        return res.status(404).json({ detail: 'account not found' });
      }

      const delta = type === 'credit' ? amount : -amount;
      const newBalance = account.balance + delta;
      if (newBalance < 0) {
        return res.status(400).json({ detail: 'insufficient funds' });
      }

      const newVersion = account.version + 1;
      const newSequence = account.lastSequence + 1;
      const eventId = uuidv4();
      const response = {
        account_id: accountId,
        event_id: eventId,
        sequence: newSequence,
        balance: newBalance,
        idempotent_replay: false,
      };

      // eslint-disable-next-line no-await-in-loop
      const session = await mongoose.startSession();
      let committed = false;
      let retry = false;
      let injectorArmed = false;

      try {
        session.startTransaction();

        if (idempotencyKey) {
          // Claim the key: only one transaction can flip pending -> completed.
          // A concurrent claimer either gets null here or a write-conflict
          // (transient) error -- both end in a retry that replays the winner.
          // eslint-disable-next-line no-await-in-loop
          const claimed = await IdempotencyCache.findOneAndUpdate(
            { _id: idempotencyKey, status: 'pending' },
            { $set: { status: 'completed', responseBody: JSON.stringify(response), responseStatus: 200 } },
            { new: true, session }
          );
          if (!claimed) {
            // eslint-disable-next-line no-await-in-loop
            await session.abortTransaction();
            retry = true;
          }
        }

        if (!retry) {
          // eslint-disable-next-line no-await-in-loop
          const updated = await Account.findOneAndUpdate(
            { _id: accountId, version: account.version },
            { $set: { balance: newBalance, version: newVersion, lastSequence: newSequence } },
            { new: true, session }
          );

          if (!updated) {
            // Someone else updated this account between our read and write.
            // eslint-disable-next-line no-await-in-loop
            await session.abortTransaction();
            retry = true;
          } else {
            if (simulateFailures) {
              failureInjector.arm(eventId, simulateFailures);
              injectorArmed = true;
            }

            // eslint-disable-next-line no-await-in-loop
            await Outbox.create(
              [
                {
                  eventId,
                  accountId,
                  eventType: `transaction.${type}`,
                  sequence: newSequence,
                  // balance = balance right after THIS event, so the audit log
                  // is correct even if the consumer runs much later.
                  payload: { amount, type, balance: newBalance },
                  published: false,
                },
              ],
              { session }
            );

            // eslint-disable-next-line no-await-in-loop
            await session.commitTransaction();
            committed = true;
            return res.status(200).json(response);
          }
        }
      } catch (err) {
        if (!committed) {
          // eslint-disable-next-line no-await-in-loop
          await session.abortTransaction().catch(() => {});
        }
        if (!isTransientTransactionError(err)) throw err;
        retry = true;
      } finally {
        if (!committed && injectorArmed) failureInjector.disarm(eventId);
        // eslint-disable-next-line no-await-in-loop
        await session.endSession();
      }

      if (retry) {
        // Small randomized backoff so losers don't immediately re-collide.
        // eslint-disable-next-line no-await-in-loop
        await sleep(Math.random() * 10 * (attempt + 1));
      }
    }

    return res.status(409).json({ detail: 'too much concurrent contention on this account, please retry' });
  } catch (err) {
    return next(err);
  }
}

module.exports = { createTransaction };
