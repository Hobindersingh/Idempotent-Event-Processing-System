import React, { useCallback, useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api.js';

export default function AuditLogPanel({ accounts, selectedAccount }) {
  const [accountId, setAccountId] = useState(selectedAccount ? selectedAccount.id : '');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedAccount) setAccountId(selectedAccount.id);
  }, [selectedAccount]);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/accounts/${accountId}/audit-log`);
      setRows(data);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="panel">
      <h3 className="panel-title">
        Audit Log (downstream projection)
        <button type="button" className="btn-secondary btn-sm" onClick={load} disabled={!accountId || loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </h3>
      <p className="panel-desc">
        Built asynchronously by the consumer worker from outbox events. Even though delivery is at-least-once,
        every event should appear here exactly once, in sequence order.
      </p>

      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="audit-account">Account</label>
        <select id="audit-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="" disabled>
            Choose an account&hellip;
          </option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.id.slice(0, 8)}...)
            </option>
          ))}
        </select>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {!accountId ? (
        <div className="empty-state">Pick an account to view its audit log.</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">No events processed for this account yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Seq</th>
              <th>Event Type</th>
              <th>Amount</th>
              <th>Balance After</th>
              <th>Event ID</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.event_id}>
                <td>{r.sequence}</td>
                <td>{r.event_type}</td>
                <td>{r.amount}</td>
                <td>{r.balance_after_event}</td>
                <td title={r.event_id}>{r.event_id.slice(0, 8)}...</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
