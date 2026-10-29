import React, { useCallback, useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../api.js';

const TILES = [
  { key: 'accounts', label: 'Accounts' },
  { key: 'outbox_unpublished', label: 'Outbox Unpublished' },
  { key: 'outbox_total', label: 'Outbox Total' },
  { key: 'processed_events', label: 'Processed Events' },
  { key: 'dead_letters_unresolved', label: 'DLQ (Unresolved)' },
  { key: 'audit_log_entries', label: 'Audit Log Entries' },
];

export default function MetricsPanel() {
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/metrics');
      setMetrics(data);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <div className="panel">
      <h3 className="panel-title">
        System Metrics
        <button type="button" className="btn-secondary btn-sm" onClick={load}>
          Refresh
        </button>
      </h3>
      <p className="panel-desc">
        Live counters from the API, polled every few seconds. <code>outbox_unpublished</code> should trend to
        zero as the relay worker catches up, and <code>dead_letters_unresolved</code> only rises when the
        retry budget is exceeded.
      </p>

      {error && <div className="error-banner">{error}</div>}

      {!metrics ? (
        <div className="empty-state">Loading metrics&hellip;</div>
      ) : (
        <div className="metrics-grid">
          {TILES.map((tile) => (
            <div key={tile.key} className="metric-tile">
              <div className="stat-value">{metrics[tile.key]}</div>
              <div className="stat-label">{tile.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
