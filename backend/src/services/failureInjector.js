/**
 * Test/demo hook: lets us deterministically force the first N processing
 * attempts for a given event to fail, so the retry -> backoff -> DLQ path
 * can be exercised on demand instead of relying on real flakiness.
 */
class TransientProcessingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TransientProcessingError';
  }
}

class FailureInjector {
  constructor() {
    this._remaining = new Map();
  }

  arm(eventId, times) {
    if (times > 0) this._remaining.set(eventId, times);
  }

  maybeFail(eventId) {
    const left = this._remaining.get(eventId) || 0;
    if (left > 0) {
      this._remaining.set(eventId, left - 1);
      throw new TransientProcessingError(
        `injected transient failure for ${eventId} (${left} remaining)`
      );
    }
  }

  /** Simulate "the downstream issue is fixed", e.g. before a DLQ replay. */
  disarm(eventId) {
    this._remaining.delete(eventId);
  }
}

module.exports = { failureInjector: new FailureInjector(), TransientProcessingError };
