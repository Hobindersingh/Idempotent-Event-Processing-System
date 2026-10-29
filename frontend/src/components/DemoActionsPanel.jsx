import React, { useState } from 'react';

export default function DemoActionsPanel({ disabled, onRunIdempotencyDemo, onRunConcurrencyDemo }) {
  const [idemAmount, setIdemAmount] = useState('25');
  const [idemTimes, setIdemTimes] = useState('5');
  const [runningIdem, setRunningIdem] = useState(false);

  const [concAmount, setConcAmount] = useState('2');
  const [concCount, setConcCount] = useState('40');
  const [runningConc, setRunningConc] = useState(false);

  const runIdem = async () => {
    setRunningIdem(true);
    try {
      await onRunIdempotencyDemo({ amount: Number(idemAmount), type: 'debit', times: Math.min(20, Math.max(2, Number(idemTimes) || 2)) });
    } finally {
      setRunningIdem(false);
    }
  };

  const runConc = async () => {
    setRunningConc(true);
    try {
      await onRunConcurrencyDemo({ amount: Number(concAmount), count: Math.min(200, Math.max(2, Number(concCount) || 2)) });
    } finally {
      setRunningConc(false);
    }
  };

  return (
    <div className="panel">
      <h3 className="panel-title">Guarantee Demos</h3>
      <p className="panel-desc">One-click proofs of the two headline guarantees, straight from the UI.</p>

      <div className="stack" style={{ marginBottom: 16 }}>
        <label style={{ textTransform: 'none', fontWeight: 700, color: 'var(--text)' }}>
          Idempotency-Key replay
        </label>
        <p className="hint" style={{ marginTop: -6 }}>
          Sends the exact same debit request N times with one Idempotency-Key, simulating a client that
          retries after a timeout. Balance should only move once.
        </p>
        <div className="row">
          <input type="number" min="0.01" step="0.01" value={idemAmount} onChange={(e) => setIdemAmount(e.target.value)} />
          <input type="number" min="2" max="20" value={idemTimes} onChange={(e) => setIdemTimes(e.target.value)} />
        </div>
        <button type="button" className="btn-secondary btn-block" onClick={runIdem} disabled={disabled || runningIdem}>
          {runningIdem ? 'Replaying...' : `Debit ${idemAmount || 0} ${idemTimes || 0}x with same key`}
        </button>
      </div>

      <div className="stack">
        <label style={{ textTransform: 'none', fontWeight: 700, color: 'var(--text)' }}>
          Concurrency stress test
        </label>
        <p className="hint" style={{ marginTop: -6 }}>
          Fires N concurrent credit requests (no idempotency key -- each is a distinct operation) and checks
          that optimistic concurrency control loses zero updates.
        </p>
        <div className="row">
          <input type="number" min="0.01" step="0.01" value={concAmount} onChange={(e) => setConcAmount(e.target.value)} />
          <input type="number" min="2" max="200" value={concCount} onChange={(e) => setConcCount(e.target.value)} />
        </div>
        <button type="button" className="btn-secondary btn-block" onClick={runConc} disabled={disabled || runningConc}>
          {runningConc ? 'Firing...' : `Fire ${concCount || 0} concurrent credits`}
        </button>
      </div>
    </div>
  );
}
