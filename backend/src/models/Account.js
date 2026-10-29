/**
 * accounts -- source of truth balance.
 *
 * `version` is the optimistic-concurrency-control (OCC) token: every
 * balance update is a `findOneAndUpdate({ _id, version: currentVersion })`
 * that also bumps version by 1. If another writer got there first, the
 * filter no longer matches, the update is a no-op, and the caller retries
 * with fresh data -- no lost updates, no row/document locking needed.
 *
 * `lastSequence` is a monotonically increasing per-account event counter
 * used downstream to detect and drop out-of-order event delivery.
 */
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const accountSchema = new mongoose.Schema(
  {
    _id: { type: String, default: uuidv4 },
    name: { type: String, required: true, minlength: 1, maxlength: 120 },
    balance: { type: Number, required: true, default: 0, min: 0 },
    version: { type: Number, required: true, default: 0 },
    lastSequence: { type: Number, required: true, default: 0 },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false }, versionKey: false }
);

module.exports = mongoose.model('Account', accountSchema);
