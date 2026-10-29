import React, { useState } from 'react';
import { uuid } from '../api.js';

export default function TransactionPanel({ disabled, onSubmit }) {
  const [amount, setAmount] = useState('10');
  const [type, setType] = useState('credit');
  const [useIdempotencyKey, setUseIdempotencyKey] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [simulateFailures, setSimulateFailures] = useState('0');
  const [submitting, setSubmitting] = useState(false);

  const handleGenerateKey = () => setIdempotencyKey(uuid());

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({
        amount,
        type,
        idempotencyKey: useIdempotencyKey ? idempotencyKey || uuid() : null,
        simulateFailures: Number(simulateFailures) || 0,
      });
    } catch {
      // handled by parent via the activity log
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="panel">
      <h3 className="panel-title">Send Transaction</h3>
      <p className="panel-desc">
        Optimistic-concurrency-controlled write + transactional outbox event, with optional Stripe-style
        idempotency and injected failure simulation.
      </p>

      <form className="stack" onSubmit={handleSubmit}>
        <div className="row">
          <div className="field">
            <label htmlFor="tx-amount">Amount</label>
            <input id="tx-amount" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="tx-type">Type</label>
            <select id="tx-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="credit">credit</option>
              <option value="debit">debit</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="tx-failures">Simulate failures (consumer will fail this many times before succeeding)</label>
          <input
            id="tx-failures"
            type="number"
            min="0"
            max="1000"
            value={simulateFailures}
            onChange={(e) => setSimulateFailures(e.target.value)}
          />
          <p className="hint">Set higher than 3 to watch the event land in the Dead Letter Queue tab.</p>
        </div>

        <div className="field">
          <label className="hstack" style={{ textTransform: 'none', fontWeight: 500 }}>
            <input
              type="checkbox"
              checked={useIdempotencyKey}
              onChange={(e) => setUseIdempotencyKey(e.target.checked)}
              style={{ width: 'auto' }}
            />
            &nbsp;Attach an Idempotency-Key header
          </label>
          {useIdempotencyKey && (
            <div className="row" style={{ marginTop: 8 }}>
              <input
                type="text"
                placeholder="idempotency key"
                value={idempotencyKey}
                onChange={(e) => setIdempotencyKey(e.target.value)}
              />
              <button type="button" className="btn-secondary" onClick={handleGenerateKey} style={{ flex: '0 0 auto' }}>
                Generate
              </button>
            </div>
          )}
        </div>

        <button type="submit" className="btn-primary btn-block" disabled={disabled || submitting}>
          {submitting ? 'Sending...' : 'Send transaction'}
        </button>
        {disabled && <p className="hint">Select or create an account first.</p>}
      </form>
    </div>
  );
}
