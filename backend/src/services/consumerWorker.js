/**
 * Pulls events off the broker queue and processes them idempotently via
 * consumer.js. In production this loop would live in its own consumer
 * service (or several, partitioned by account_id to preserve ordering).
 */
const brokerQueue = require('./broker');
const { processEvent } = require('./consumer');

class ConsumerWorker {
  constructor() {
    this._stopped = true;
    this._loopPromise = null;
  }

  start() {
    this._stopped = false;
    this._loopPromise = this._run();
  }

  stop() {
    this._stopped = true;
  }

  async _run() {
    while (!this._stopped) {
      // eslint-disable-next-line no-await-in-loop
      const event = await brokerQueue.get(100);
      if (!event) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await processEvent(event);
      } catch (err) {
        console.error('[consumer-worker] unhandled error processing', event.eventId, err);
      }
    }
  }
}

module.exports = ConsumerWorker;
