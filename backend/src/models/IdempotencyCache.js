/**
 * idempotency_cache -- API-layer idempotency (Stripe-style `Idempotency-Key`
 * header). Guarantees a client retry gets back the EXACT same response
 * instead of double-applying the operation.
 *
 * `_id` is the client-supplied idempotency key itself, which is what makes
 * the "create if absent" step below atomic: Mongo's upsert is a single
 * atomic operation, so two racing requests with the same key can never
 * both believe they "won" and created the pending row.
 */
const mongoose = require('mongoose');

const idempotencyCacheSchema = new mongoose.Schema(
  {
    _id: { type: String }, // the Idempotency-Key header value
    endpoint: { type: String, required: true },
    requestFingerprint: { type: String, required: true },
    status: { type: String, required: true, default: 'pending', enum: ['pending', 'completed'] },
    responseBody: { type: String, default: null },
    responseStatus: { type: Number, default: null },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false }, versionKey: false }
);

// Idempotency keys expire after 24h (like Stripe) so the collection can't grow forever.
idempotencyCacheSchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

module.exports = mongoose.model('IdempotencyCache', idempotencyCacheSchema);
