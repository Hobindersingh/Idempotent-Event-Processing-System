/**
 * Polls the outbox collection for unpublished rows and pushes them onto
 * the broker queue, then marks them published. This is the second half of
 * the transactional outbox pattern -- the write to `outbox` happened in
 * the same DB transaction as the business change, so this relay can be
 * slow, crash, and restart without ever losing an event.
 *
 * In production this loop would live in its own relay service, and
 * `brokerQueue.put` would become a real producer.send(topic, event) call.
 */
const Outbox = require('../models/Outbox');
const brokerQueue = require('./broker');

class RelayWorker {
  constructor(pollIntervalMs = 50) {
    this.pollIntervalMs = pollIntervalMs;
    this._stopped = true;
    this._timer = null;
  }

  start() {
    this._stopped = false;
    this._scheduleNext(0);
  }

  stop() {
    this._stopped = true;
    if (this._timer) clearTimeout(this._timer);
  }

  _scheduleNext(delay) {
    if (this._stopped) return;
    this._timer = setTimeout(() => this._tick(), delay);
  }

  async _tick() {
    if (this._stopped) return;
    try {
      const rows = await Outbox.find({ published: false }).sort({ createdAt: 1, sequence: 1, _id: 1 }).limit(50);
      for (const row of rows) {
        brokerQueue.put({
          eventId: row.eventId,
          accountId: row.accountId,
          eventType: row.eventType,
          sequence: row.sequence,
          ...row.payload,
        });
        // eslint-disable-next-line no-await-in-loop
        await Outbox.updateOne({ _id: row._id }, { $set: { published: true } });
      }
    } catch (err) {
      console.error('[relay-worker] poll failed:', err.message);
    }
    this._scheduleNext(this.pollIntervalMs);
  }
}

module.exports = RelayWorker;
