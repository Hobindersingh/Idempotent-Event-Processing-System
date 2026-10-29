/**
 * Deterministic fingerprint of a transaction request, used to detect when
 * an Idempotency-Key is being reused with a DIFFERENT request body (which
 * must be rejected -- an idempotency key is a promise "retry of the exact
 * same request", not a free pass to overwrite one operation with another).
 */
const crypto = require('crypto');

function computeFingerprint(accountId, amount, type) {
  // Field order is fixed explicitly (not relying on object key insertion
  // order) so the fingerprint is stable across processes/restarts.
  const raw = JSON.stringify({
    account_id: accountId,
    amount,
    type,
  }, ['account_id', 'amount', 'type']);
  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = { computeFingerprint };
