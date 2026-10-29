/**
 * Express app factory. Kept separate from server.js so tests can build the
 * app (and hit it with supertest) without also binding a real TCP port or
 * re-running the DB-connect / worker-start bootstrap logic.
 */
const express = require('express');
const cors = require('cors');

const accountsRouter = require('./routes/accounts');
const dlqRouter = require('./routes/dlq');
const metricsRouter = require('./routes/metrics');
const errorHandler = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  // CORS_ORIGIN can be a comma-separated allow-list (e.g. your deployed
  // frontend URL). Unset = allow all origins (fine for local dev only).
  const allowed = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
  app.use(cors(allowed.length ? { origin: allowed } : undefined));
  app.use(express.json());

  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

  app.use('/accounts', accountsRouter);
  app.use('/dlq', dlqRouter);
  app.use('/metrics', metricsRouter);

  app.use((req, res) => res.status(404).json({ detail: 'not found' }));
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
