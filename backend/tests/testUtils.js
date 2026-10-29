/**
 * Shared test helpers. Tests run against a REAL MongoDB replica set (see
 * README.md "Running the tests") because the whole point of this project
 * is to exercise real multi-document transactions -- an in-memory fake
 * would hide the exact bugs (write conflicts, transaction aborts) these
 * tests are designed to catch.
 */
const mongoose = require('mongoose');

const DEFAULT_TEST_URI = 'mongodb://127.0.0.1:27017/idempotent_events_test?replicaSet=rs0';

async function connectTestDB() {
  const uri = process.env.MONGO_URI || DEFAULT_TEST_URI;
  await mongoose.connect(uri);
  // Make sure collections + indexes exist before any transaction touches them.
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
}

async function clearTestDB() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

async function disconnectTestDB() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

module.exports = { connectTestDB, clearTestDB, disconnectTestDB };
