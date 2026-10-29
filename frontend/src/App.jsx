import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, apiErrorMessage, uuid } from './api.js';

import Header from './components/Header.jsx';
import AccountPanel from './components/AccountPanel.jsx';
import TransactionPanel from './components/TransactionPanel.jsx';
import DemoActionsPanel from './components/DemoActionsPanel.jsx';
import EventLogPanel from './components/EventLogPanel.jsx';
import AuditLogPanel from './components/AuditLogPanel.jsx';
import DlqPanel from './components/DlqPanel.jsx';
import MetricsPanel from './components/MetricsPanel.jsx';
import GuaranteesPanel from './components/GuaranteesPanel.jsx';

const TABS = [
  { id: 'workbench', label: 'Workbench' },
  { id: 'audit', label: 'Audit Log' },
  { id: 'dlq', label: 'Dead Letter Queue' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'guarantees', label: 'How It Works' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('workbench');
  const [accounts, setAccounts] = useState([]); // accounts created this session
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [account, setAccount] = useState(null);
  const [events, setEvents] = useState([]);
  const [apiOnline, setApiOnline] = useState(null);

  const logEvent = useCallback((message, level = 'info') => {
    setEvents((prev) => [
      ...prev.slice(-99),
      { id: uuid(), ts: new Date().toLocaleTimeString(), message, level },
    ]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/healthz')
      .then(() => !cancelled && setApiOnline(true))
      .catch(() => !cancelled && setApiOnline(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshAccount = useCallback(async (accountId) => {
    if (!accountId) return;
    try {
      const { data } = await api.get(`/accounts/${accountId}`);
      setAccount(data);
    } catch (err) {
      logEvent(`Failed to refresh account: ${apiErrorMessage(err)}`, 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedAccountId) refreshAccount(selectedAccountId);
    else setAccount(null);
  }, [selectedAccountId, refreshAccount]);

  const handleCreateAccount = useCallback(
    async (name, openingBalance) => {
      try {
        const { data } = await api.post('/accounts', { name, opening_balance: openingBalance });
        setAccounts((prev) => [data, ...prev]);
        setSelectedAccountId(data.id);
        logEvent(`Created account "${data.name}" (${data.id.slice(0, 8)}...) with balance ${data.balance}`, 'ok');
      } catch (err) {
        logEvent(`Create account failed: ${apiErrorMessage(err)}`, 'error');
      }
    },
    [logEvent]
  );

  const sendTransaction = useCallback(
    async ({ amount, type, idempotencyKey, simulateFailures }) => {
      const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {};
      const body = { amount: Number(amount), type };
      if (simulateFailures) body.simulate_failures = Number(simulateFailures);

      const { data } = await api.post(`/accounts/${selectedAccountId}/transactions`, body, { headers });
      return data;
    },
    [selectedAccountId]
  );

  const handleTransaction = useCallback(
    async (form) => {
      try {
        const data = await sendTransaction(form);
        const replayTag = data.idempotent_replay ? ' [IDEMPOTENT REPLAY -- not re-applied]' : '';
        logEvent(
          `${form.type.toUpperCase()} ${form.amount} -> balance=${data.balance}, seq=${data.sequence}${replayTag}`,
          data.idempotent_replay ? 'warn' : 'ok'
        );
        await refreshAccount(selectedAccountId);
        return data;
      } catch (err) {
        logEvent(`Transaction failed: ${apiErrorMessage(err)}`, 'error');
        throw err;
      }
    },
    [sendTransaction, refreshAccount, selectedAccountId, logEvent]
  );

  const runIdempotencyDemo = useCallback(
    async ({ amount, type, times }) => {
      const key = uuid();
      logEvent(`Idempotency demo: firing the SAME request ${times}x with Idempotency-Key=${key.slice(0, 8)}...`, 'info');
      const results = [];
      for (let i = 0; i < times; i += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const data = await sendTransaction({ amount, type, idempotencyKey: key });
          results.push(data);
          logEvent(
            `  attempt ${i + 1}/${times}: balance=${data.balance} replay=${data.idempotent_replay}`,
            data.idempotent_replay ? 'warn' : 'ok'
          );
        } catch (err) {
          logEvent(`  attempt ${i + 1}/${times} errored: ${apiErrorMessage(err)}`, 'error');
        }
      }
      await refreshAccount(selectedAccountId);
      const applied = results.filter((r) => !r.idempotent_replay).length;
      logEvent(
        `Idempotency demo done: ${times} identical requests sent, ${applied} applied, ${results.length - applied} replayed.`,
        applied === 1 ? 'ok' : 'warn'
      );
      return results;
    },
    [sendTransaction, refreshAccount, selectedAccountId, logEvent]
  );

  const runConcurrencyDemo = useCallback(
    async ({ amount, count }) => {
      logEvent(`Concurrency demo: firing ${count} concurrent credit requests of ${amount} each (no Idempotency-Key)...`, 'info');
      const before = account ? account.balance : null;
      const jobs = Array.from({ length: count }, () => sendTransaction({ amount, type: 'credit' }).catch((e) => ({ error: e })));
      const results = await Promise.all(jobs);
      const succeeded = results.filter((r) => !r.error).length;
      const failed = results.length - succeeded;
      await refreshAccount(selectedAccountId);
      logEvent(
        `Concurrency demo done: ${succeeded}/${count} succeeded, ${failed} failed. ` +
          (before !== null ? `Balance ${before} -> expect +${succeeded * Number(amount)}.` : ''),
        failed > 0 ? 'warn' : 'ok'
      );
      return results;
    },
    [sendTransaction, refreshAccount, selectedAccountId, account, logEvent]
  );

  const selectedAccountSummary = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId) || null,
    [accounts, selectedAccountId]
  );

  return (
    <div className="app-shell">
      <Header activeTab={activeTab} onTabChange={setActiveTab} tabs={TABS} apiOnline={apiOnline} />

      {apiOnline === false && (
        <div className="error-banner">
          Can&rsquo;t reach the backend API. Make sure it&rsquo;s running (<code>npm start</code> in{' '}
          <code>backend/</code>) on port 8000, and that <code>VITE_API_URL</code> is set correctly (or
          blank to use the Vite dev proxy).
        </div>
      )}

      {activeTab === 'workbench' && (
        <div className="grid">
          <div>
            <AccountPanel
              accounts={accounts}
              account={account}
              selectedAccountId={selectedAccountId}
              onSelectAccount={setSelectedAccountId}
              onCreateAccount={handleCreateAccount}
              onRefresh={() => refreshAccount(selectedAccountId)}
            />
          </div>
          <div>
            <TransactionPanel
              disabled={!selectedAccountId}
              onSubmit={handleTransaction}
            />
            <DemoActionsPanel
              disabled={!selectedAccountId}
              onRunIdempotencyDemo={runIdempotencyDemo}
              onRunConcurrencyDemo={runConcurrencyDemo}
            />
            <div className="panel">
              <h3 className="panel-title">Activity Log</h3>
              <p className="panel-desc">Every request this dashboard makes, and how the API responded.</p>
              <EventLogPanel events={events} />
            </div>
          </div>
        </div>
      )}

      {activeTab === 'audit' && <AuditLogPanel selectedAccount={selectedAccountSummary} accounts={accounts} />}
      {activeTab === 'dlq' && <DlqPanel logEvent={logEvent} />}
      {activeTab === 'metrics' && <MetricsPanel />}
      {activeTab === 'guarantees' && <GuaranteesPanel />}

      <p className="footer-note">
        Idempotent Event Processing System &middot; MERN stack (MongoDB, Express, React, Node.js) &middot;
        Effectively-once processing on top of at-least-once delivery.
      </p>
    </div>
  );
}
