import React from 'react';

const GUARANTEES = [
  {
    guarantee: 'A client retrying the same write (e.g. after a timeout) never double-applies it',
    mechanism: 'Idempotency-Key header with a cached response (Stripe-style) -- POST /accounts/:id/transactions',
  },
  {
    guarantee: 'Concurrent writes to the same account never lose an update',
    mechanism: 'Optimistic concurrency control on accounts.version; conflicting writers retry with backoff',
  },
  {
    guarantee: 'An event is never silently dropped between "balance updated" and "event published"',
    mechanism: 'Transactional outbox pattern -- the outbox document is written in the same MongoDB transaction as the balance change',
  },
  {
    guarantee: "A broker redelivering the same event (at-least-once delivery) doesn't double-apply it",
    mechanism: 'ProcessedEvent dedup collection, keyed on event_id, checked before any side effect',
  },
  {
    guarantee: "Events that arrive late/out of order don't corrupt downstream state",
    mechanism: 'Per-account monotonic sequence number; stale sequences are dropped, not applied',
  },
  {
    guarantee: "Transient failures don't lose events or retry forever",
    mechanism: 'Exponential backoff retry, then quarantine to a dead-letter collection, with a replay endpoint',
  },
  {
    guarantee: 'Two workers racing on the exact same event',
    mechanism: "The dedup insert's unique-key constraint is the race-resolution mechanism, not a separate lock",
  },
];

const ARCHITECTURE = `
Client --POST /transactions--> Express API layer
                                   |  1. check Idempotency-Key cache (atomic upsert)
                                   |  2. optimistic-concurrency balance update
                                   |  3. write outbox doc   -+ same MongoDB transaction
                                   |  4. commit              -+
                                   v
                             accounts collection (source of truth)
                                   |
                           outbox collection (unpublished events)
                                   |
                     RelayWorker (polls, publishes, marks published)
                                   |
                           broker queue (at-least-once, in-memory demo)
                                   |
                     ConsumerWorker --> consumer.processEvent()
                                   |      - dedup check (ProcessedEvent)
                                   |      - sequence check (ConsumerState)
                                   |      - retry w/ backoff on failure
                                   |      - DLQ after max retries
                                   v
                           audit_log collection (downstream read-model)
`.trim();

export default function GuaranteesPanel() {
  return (
    <div>
      <div className="panel">
        <h3 className="panel-title">What this system guarantees, and how</h3>
        <p className="panel-desc">
          The write path (balance) is strongly consistent and synchronous. The event pipeline (audit log /
          anything else downstream) is asynchronous and eventually consistent -- the same split you&rsquo;d see
          between &ldquo;charge the customer&rdquo; and &ldquo;send the receipt email&rdquo;.
        </p>
        <table className="guarantee-table">
          <tbody>
            {GUARANTEES.map((g) => (
              <tr key={g.guarantee}>
                <td>{g.guarantee}</td>
                <td>{g.mechanism}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h3 className="panel-title">Architecture</h3>
        <div className="arch-diagram">{ARCHITECTURE}</div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Stack</h3>
        <p className="panel-desc" style={{ marginBottom: 0 }}>
          <strong>MongoDB</strong> (replica-set transactions for the outbox + OCC patterns) &middot;{' '}
          <strong>Express</strong> (REST API) &middot; <strong>React + Vite</strong> (this dashboard) &middot;{' '}
          <strong>Node.js</strong> (background relay &amp; consumer workers, in-process). See the project{' '}
          <code>README.md</code> for the full write-up, test suite, and notes on scaling this to a real broker
          like Kafka or SQS.
        </p>
      </div>
    </div>
  );
}
