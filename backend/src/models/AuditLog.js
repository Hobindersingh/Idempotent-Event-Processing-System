/**
 * audit_log -- downstream read-model / projection built asynchronously by
 * the consumer from outbox events. Demonstrates that even though this is
 * fed by an at-least-once delivery mechanism, each event is reflected here
 * exactly once.
 */
const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    accountId: { type: String, required: true, index: true },
    eventType: { type: String, required: true },
    amount: { type: Number, required: true },
    sequence: { type: Number, required: true },
    balanceAfterEvent: { type: Number, required: true },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false }, versionKey: false }
);

module.exports = mongoose.model('AuditLog', auditLogSchema);
