import React from 'react';

export default function Header({ tabs, activeTab, onTabChange, apiOnline }) {
  return (
    <header className="app-header">
      <div className="app-title">
        <span className="dot" style={{ background: apiOnline === null ? 'var(--muted, #888)' : apiOnline ? 'var(--green)' : 'var(--red)' }} />
        Idempotent Event Processing System
      </div>
      <p className="app-subtitle">
        A small but complete event-processing pipeline that guarantees <strong>effectively-once</strong> processing
        on top of an <strong>at-least-once</strong> delivery model &mdash; the problem every real distributed system
        (payments, order processing, webhooks) eventually has to solve. Built with MongoDB, Express, React and
        Node.js.
      </p>

      <nav className="tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
