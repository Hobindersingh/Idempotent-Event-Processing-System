/**
 * MongoDB connection helper.
 *
 * This app relies on multi-document ACID transactions (for the
 * transactional-outbox pattern and optimistic concurrency control), which
 * MongoDB only supports against a replica set (even a single-node one) or
 * a sharded cluster -- never a plain standalone mongod. See README.md for
 * the one-time `rs.initiate()` setup step.
 */
const mongoose = require('mongoose');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Connects with retries. This matters because right after `mongo-init`
 * runs `rs.initiate()`, MongoDB needs a moment to elect a primary before
 * it can actually accept connections/transactions -- if the backend
 * container starts a beat before that finishes (e.g. under Docker Compose
 * versions where container start order isn't a hard guarantee), a single
 * connect attempt can fail even though everything is configured
 * correctly. Retrying with backoff makes startup order a non-issue.
 */
async function connectDB(uri, { maxAttempts = 30, delayMs = 2000 } = {}) {
  mongoose.set('strictQuery', true);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
      const { name, host, port } = mongoose.connection;
      // Build collections + indexes BEFORE serving traffic: transactions that
      // touch a collection whose creation/index build is still in flight can fail.
      await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
      console.log(`[db] connected to MongoDB database "${name}" at ${host}:${port}`);
      return mongoose.connection;
    } catch (err) {
      const isLastAttempt = attempt === maxAttempts;
      console.log(
        `[db] connection attempt ${attempt}/${maxAttempts} failed (${err.message}).` +
          (isLastAttempt ? '' : ' Retrying in a moment...')
      );
      if (isLastAttempt) throw err;
      await sleep(delayMs);
    }
  }
  return undefined; // unreachable, keeps linters happy
}

module.exports = connectDB;
