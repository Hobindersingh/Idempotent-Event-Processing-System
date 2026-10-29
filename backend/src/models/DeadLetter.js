/**
 * dead_letters -- events that failed processing after exhausting their
 * retry budget. Quarantined here instead of being silently dropped or
 * retried forever; `POST /dlq/:id/replay` re-runs them through the same
 * idempotent processing path once the underlying issue is fixed.
 */
const mongoose = require('mongoose');

const deadLetterSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, index: true },
    accountId: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    error: { type: String, required: true },
    attempts: { type: Number, required: true, default: 0 },
    resolved: { type: Boolean, required: true, default: false, index: true },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false }, versionKey: false }
);

module.exports = mongoose.model('DeadLetter', deadLetterSchema);
