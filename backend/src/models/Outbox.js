/**
 * outbox -- transactional outbox. A row is written in the SAME DB
 * transaction as the balance update, so the event can never be "forgotten"
 * even if the process crashes right after commit. RelayWorker polls this
 * table for unpublished rows and hands them to the broker.
 */
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const outboxSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true, default: uuidv4 },
    accountId: { type: String, required: true, index: true },
    eventType: { type: String, required: true },
    sequence: { type: Number, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    published: { type: Boolean, required: true, default: false, index: true },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false }, versionKey: false }
);

module.exports = mongoose.model('Outbox', outboxSchema);
