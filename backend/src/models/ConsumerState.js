/**
 * consumer_state -- last sequence number successfully applied per account.
 * Used to detect and drop out-of-order / stale events without needing a
 * separate ordering guarantee from the broker itself.
 */
const mongoose = require('mongoose');

const consumerStateSchema = new mongoose.Schema(
  {
    _id: { type: String }, // account_id
    lastAppliedSequence: { type: Number, required: true, default: 0 },
  },
  { versionKey: false }
);

module.exports = mongoose.model('ConsumerState', consumerStateSchema);
