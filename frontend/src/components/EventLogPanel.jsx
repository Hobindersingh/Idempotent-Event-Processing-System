import React from 'react';

export default function EventLogPanel({ events }) {
  if (!events.length) {
    return <div className="empty-state">Nothing yet &mdash; create an account and send a transaction to see activity here.</div>;
  }

  return (
    <div className="event-log">
      {[...events].reverse().map((e) => (
        <div key={e.id} className={`event-log-entry ${e.level}`}>
          <span className="ts">{e.ts}</span>
          {e.message}
        </div>
      ))}
    </div>
  );
}
