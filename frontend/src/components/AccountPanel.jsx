import React, { useState } from 'react';

export default function AccountPanel({ accounts, account, selectedAccountId, onSelectAccount, onCreateAccount, onRefresh }) {
  const [name, setName] = useState('');
  const [openingBalance, setOpeningBalance] = useState('100');
  const [creating, setCreating] = useState(false);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      await onCreateAccount(name.trim(), Number(openingBalance) || 0);
      setName('');
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <div className="panel">
        <h3 className="panel-title">Create Account</h3>
        <p className="panel-desc">Every account starts with a balance, a version (OCC token), and a sequence counter.</p>
        <form className="stack" onSubmit={handleCreate}>
          <div className="field">
            <label htmlFor="acc-name">Name</label>
            <input id="acc-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alice" />
          </div>
          <div className="field">
            <label htmlFor="acc-balance">Opening balance</label>
            <input
              id="acc-balance"
              type="number"
              min="0"
              step="0.01"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary btn-block" disabled={creating || !name.trim()}>
            {creating ? 'Creating...' : 'Create account'}
          </button>
        </form>
      </div>

      <div className="panel">
        <h3 className="panel-title">
          Select Account
          <button type="button" className="btn-secondary btn-sm" onClick={onRefresh} disabled={!selectedAccountId}>
            Refresh
          </button>
        </h3>
        {accounts.length === 0 ? (
          <div className="empty-state">No accounts yet in this session.</div>
        ) : (
          <div className="field">
            <select value={selectedAccountId || ''} onChange={(e) => onSelectAccount(e.target.value)}>
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
        )}

        {account && (
          <div className="account-card">
            <div className="account-name">{account.name}</div>
            <div className="account-id">{account.id}</div>
            <div className="balance-row">
              <div className="stat">
                <div className="stat-value">{account.balance}</div>
                <div className="stat-label">Balance</div>
              </div>
              <div className="stat">
                <div className="stat-value">{account.version}</div>
                <div className="stat-label">Version (OCC)</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
