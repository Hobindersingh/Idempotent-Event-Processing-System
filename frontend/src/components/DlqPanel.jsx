import React, { useCallback, useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api.js';

export default function DlqPanel({ logEvent }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [replayingId, setReplayingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/dlq');
      setRows(data);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [load]);

  const handleReplay = async (id) => {
    setReplayingId(id);
    try {
      const { data } = await api.post(`/dlq/${id}/replay`);
      logEvent(`Replayed dead letter ${id.slice(0, 8)}... -> status=${data.status}`, data.status === 'applied' ? 'ok' : 'warn');
      await load();
    } catch (err) {
      logEvent(`Replay failed for ${id.slice(0, 8)}...: ${apiErrorMessage(err)}`, 'error');
    } finally {
      setReplayingId(null);
    }
  };

  return (
    <div className="panel">
      <h3 className="panel-title">
        Dead Letter Queue
        <button type="button" className="btn-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </h3>
      <p className="panel-desc">
        Events that exhausted their retry budget land here instead of being silently dropped or retried
        forever. Replaying re-runs them through the same idempotent processing path.
      </p>

      {error && <div className="error-banner">{error}</div>}

      {rows.length === 0 ? (
        <div className="empty-state">
          Empty. Send a transaction from the Workbench tab with &ldquo;Simulate failures&rdquo; set above 3 to
          land an event here.
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Event ID</th>
              <th>Account</th>
              <th>Attempts</th>
              <th>Error</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td title={r.event_id}>{r.event_id.slice(0, 8)}...</td>
                <td title={r.account_id}>{r.account_id.slice(0, 8)}...</td>
                <td>
                  <span className="badge badge-amber">{r.attempts}</span>
                </td>
                <td style={{ maxWidth: 260, whiteSpace: 'normal' }}>{r.error}</td>
                <td>
                  <button type="button" className="btn-primary btn-sm" onClick={() => handleReplay(r.id)} disabled={replayingId === r.id}>
                    {replayingId === r.id ? 'Replaying...' : 'Replay'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
