/**
 * In-memory stand-in for a real message broker (Kafka/SQS/RabbitMQ).
 *
 * In production this file would be swapped for a Kafka producer/consumer
 * or an SQS client; RelayWorker and ConsumerWorker only depend on `put`
 * and `get`, so that swap is localized to this one file. Delivery through
 * this queue is treated as AT-LEAST-ONCE (a message can conceptually be
 * redelivered), which is exactly why the dedup logic in consumer.js exists
 * -- it's not implemented as a bug, it's the reason the rest of the system
 * exists.
 */
class BrokerQueue {
  constructor() {
    this._items = [];
    this._waiters = [];
  }

  put(event) {
    if (this._waiters.length > 0) {
      const resolve = this._waiters.shift();
      resolve(event);
    } else {
      this._items.push(event);
    }
  }

  /** Resolves with the next event, or null if nothing arrives within timeoutMs. */
  get(timeoutMs = 100) {
    if (this._items.length > 0) {
      return Promise.resolve(this._items.shift());
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this._waiters.indexOf(onEvent);
        if (idx !== -1) this._waiters.splice(idx, 1);
        resolve(null);
      }, timeoutMs);

      const onEvent = (event) => {
        clearTimeout(timer);
        resolve(event);
      };
      this._waiters.push(onEvent);
    });
  }

  size() {
    return this._items.length;
  }
}

// Singleton: the whole process shares one broker queue, exactly like a
// real broker topic is shared by whichever process talks to it.
module.exports = new BrokerQueue();
