require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('./src/config/db');
const createApp = require('./src/app');
const RelayWorker = require('./src/services/relayWorker');
const ConsumerWorker = require('./src/services/consumerWorker');

const PORT = process.env.PORT || 8000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/idempotent_events?replicaSet=rs0';

async function main() {
  await connectDB(MONGO_URI);

  const relayWorker = new RelayWorker();
  const consumerWorker = new ConsumerWorker();
  relayWorker.start();
  consumerWorker.start();
  console.log('[startup] background relay + consumer workers started');

  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`[startup] API listening on http://localhost:${PORT}  (docs: see README.md)`);
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[shutdown] received ${signal}, shutting down gracefully...`);
    relayWorker.stop();
    consumerWorker.stop();
    server.close(async () => {
      console.log('[shutdown] HTTP server closed');
      await mongoose.disconnect().catch(() => {});
      process.exit(0);
    });
    // Force-exit if close() hangs for some reason.
    setTimeout(() => process.exit(0), 3000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));

main().catch((err) => {
  console.error('[startup] fatal error, exiting:', err);
  process.exit(1);
});
