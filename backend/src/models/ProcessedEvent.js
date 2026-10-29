/**
 * processed_events -- consumer-side dedup ledger. `_id` is the event_id,
 * so a second insert attempt for the same event fails fast on the unique
 * primary key -- that failure IS the dedup check, so there's no
 * check-then-act race between two workers processing the same redelivery.
 */
const mongoose = require('mongoose');

const processedEventSchema = new mongoose.Schema(
  {
    _id: { type: String }, // event_id
    accountId: { type: String, required: true },
    result: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: 'processedAt', updatedAt: false }, versionKey: false }
);

module.exports = mongoose.model('ProcessedEvent', processedEventSchema);
