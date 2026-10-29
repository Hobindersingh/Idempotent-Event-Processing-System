# Idempotent Event Processing System (MERN Stack)

A small but complete event-processing pipeline that guarantees **effectively-once**
processing on top of an **at-least-once** delivery model — the problem every
real distributed system (payments, order processing, webhooks) eventually
has to solve.

Built with **MongoDB + Express + React + Node.js**. This is a MERN port of an
original FastAPI/SQLAlchemy/SQLite implementation, rebuilt end-to-end with
MongoDB multi-document transactions standing in for SQL transactions, and a
React dashboard added on top so every guarantee can be demonstrated live,
not just proven by a test suite.

> Every pattern used here is a real production pattern — swapping the
> in-process queue for Kafka/SQS, or the single-node Mongo replica set for a
> multi-node cluster, is a config change, not a rewrite.

## What it actually guarantees, and how

| Guarantee | Mechanism |
|---|---|
| A client retrying the same write (e.g. after a timeout) never double-applies it | `Idempotency-Key` header, cached response (Stripe-style) — see `POST /accounts/:id/transactions` |
| Concurrent writes to the same account never lose an update | Optimistic concurrency control on `accounts.version`; conflicting writers retry with backoff |
| An event is never silently dropped between "balance updated" and "event published" | Transactional outbox pattern — the outbox document is written in the *same* MongoDB transaction as the balance change |
| A broker redelivering the same event (at-least-once delivery) doesn't double-apply it | `ProcessedEvent` dedup collection, keyed on `event_id`, checked before any side effect |
| Events that arrive late/out of order don't corrupt downstream state | Per-account monotonic `sequence` number; stale sequences are dropped, not applied |
| Transient failures don't lose events or retry forever | Exponential backoff retry, then quarantine to a dead-letter collection (`dead_letters`), with a replay endpoint |
| Two workers racing on the exact same event | The dedup insert's unique-key constraint is the race-resolution mechanism, not a separate lock |

## Architecture

```
Client ──POST /transactions──▶ Express API layer
                                  │  1. check Idempotency-Key cache (atomic upsert)
                                  │  2. optimistic-concurrency balance update
                                  │  3. write outbox doc   ─┐ same MongoDB transaction
                                  │  4. commit              ┘
                                  ▼
                            accounts collection (source of truth)
                                  │
                          outbox collection (unpublished events)
                                  │
                    RelayWorker (polls, publishes, marks published)
                                  │
                          broker queue (at-least-once, in-memory demo)
                                  │
                    ConsumerWorker ──▶ consumer.processEvent()
                                  │      • dedup check (ProcessedEvent)
                                  │      • sequence check (ConsumerState)
                                  │      • retry w/ backoff on failure
                                  │      • DLQ after max retries
                                  ▼
                          audit_log collection (downstream read-model)
```

The write path (balance) is strongly consistent and synchronous. The event
pipeline (audit log / anything else downstream) is asynchronous and
eventually consistent — which is realistic: this is the same split you'd
see between "charge the customer" and "send the receipt email".

## Project layout

```
mern-idempotent-event-system/
├── backend/                  Express API + background workers (Node.js)
│   ├── server.js             entry point
│   ├── src/
│   │   ├── config/db.js      MongoDB connection
│   │   ├── models/           Mongoose schemas (7 collections, see below)
│   │   ├── controllers/      route handlers
│   │   ├── routes/           Express routers
│   │   ├── services/         consumer.js, relayWorker.js, consumerWorker.js,
│   │   │                     broker.js, failureInjector.js
│   │   ├── middleware/       centralized error handler
│   │   └── utils/            request fingerprinting
│   ├── scripts/               demo.js and loadTest.js (ported from the
│   │                          original Python demo/load-test scripts)
│   ├── tests/                 Jest + Supertest test suite (16 tests)
│   └── Dockerfile
├── frontend/                  React (Vite) dashboard
│   └── src/
│       ├── App.jsx            state + layout
│       └── components/        AccountPanel, TransactionPanel,
│                               DemoActionsPanel, AuditLogPanel, DlqPanel,
│                               MetricsPanel, GuaranteesPanel, EventLogPanel
├── docker-compose.yml          one-command full-stack run (incl. Mongo replica set)
└── README.md
```

### Data model (MongoDB collections)

| Collection | Purpose |
|---|---|
| `accounts` | source of truth balance; `version` is the OCC token |
| `idempotencycaches` | API-layer idempotency (`Idempotency-Key` header) |
| `outboxes` | transactional outbox — written in the same txn as the balance update |
| `processedevents` | consumer-side dedup ledger, `_id` = `event_id` |
| `consumerstates` | last sequence number applied per account |
| `deadletters` | events that exhausted their retry budget |
| `auditlogs` | downstream read-model built by the consumer |

## Running it

### Option A — Docker Compose (recommended, one command)

```bash
docker compose up --build
```

This starts a single-node MongoDB **replica set** (required for the
multi-document transactions this project relies on), the backend API on
`http://localhost:8000`, and the React dashboard on `http://localhost:5173`.

### Option B — run locally without Docker

You need Node.js 18+ and MongoDB 6+.

**1. Start MongoDB as a (single-node) replica set.** This is a one-time,
standard local-dev step — MongoDB only supports multi-document transactions
against a replica set, never a plain standalone `mongod`:

```bash
mongod --replSet rs0 --dbpath /path/to/your/data/dir
# in another terminal, one time only:
mongosh --eval "rs.initiate()"
```

**2. Start the backend:**

```bash
cd backend
cp .env.example .env    # defaults already point at mongodb://127.0.0.1:27017/...?replicaSet=rs0
npm install
npm start
# → API listening on http://localhost:8000
```

**3. Start the frontend, in a second terminal:**

```bash
cd frontend
cp .env.example .env    # defaults to VITE_API_URL=http://localhost:8000
npm install
npm run dev
# → dashboard on http://localhost:5173
```

### Watch the guarantees live

With the backend running:

```bash
cd backend
npm run demo
```

Or just open the React dashboard (`http://localhost:5173`) — the
**Workbench** tab has one-click "Guarantee Demos" buttons that fire the
same idempotent request N times, or N concurrent requests, and the
**Dead Letter Queue** / **Metrics** / **Audit Log** tabs update live.

### Load test

```bash
cd backend
npm start &
npm run loadtest -- --requests 500 --concurrency 20
```

Measures throughput and *proves* no lost updates under concurrency (final
`version` should equal the successful request count).

## Running the tests

Tests run against a **real MongoDB replica set** (see step 1 above, or point
`MONGO_URI` at a dedicated test database) — deliberately not an in-memory
fake, because the whole point of this project is to exercise genuine
multi-document transactions, and a fake would hide exactly the bugs
(write conflicts, transaction aborts) these tests are designed to catch.

```bash
cd backend
npm install
npm test
```

16 tests, covering:
- duplicate delivery → applied exactly once
- out-of-order events → dropped, not misapplied
- transient failure → recovers via retry
- persistent failure → dead-lettered, not lost
- dead-letter replay after a fix
- events for different accounts stay independent
- `Idempotency-Key` prevents double-apply, including across 3 identical retries
- reusing a key with a different request body is rejected (422)
- 40 concurrent transactions on one account → zero lost updates, `version` matches successful-request count exactly
- full outbox → relay → consumer → audit-log pipeline end to end
- DLQ + replay over the real HTTP API

## API

| Method | Path | Notes |
|---|---|---|
| POST | `/accounts` | create an account |
| GET | `/accounts/:id` | balance + version |
| POST | `/accounts/:id/transactions` | supports `Idempotency-Key` header; body: `{ amount, type: "credit"\|"debit", simulate_failures? }` |
| GET | `/accounts/:id/audit-log` | downstream projection built by the consumer |
| GET | `/dlq` | unresolved dead-lettered events |
| POST | `/dlq/:id/replay` | reprocess a dead-lettered event |
| GET | `/metrics` | outbox backlog, dedup count, DLQ size, etc. |
| GET | `/healthz` | liveness check |

## Bugs found in code review and fixed

- **Double-apply with concurrent same-key requests.** Previously two simultaneous
  requests with the same `Idempotency-Key` could both debit the account (OCC does
  not stop it, because the second request just reads the fresh balance). Now the
  key is *claimed* (`pending -> completed`) inside the same MongoDB transaction as
  the balance change, so exactly one wins and the other replays its response.
- **Idempotency upsert race.** Concurrent upserts of a brand-new key can throw
  `E11000`; this is now caught and the existing row is read.
- **Wrong `balance_after_event` in the audit log.** It used the account's *current*
  balance at consume time. The outbox payload now carries the balance right after
  the event.
- **Events lost on non-injected errors.** Any non-transient error in the consumer
  used to be rethrown after the event was already marked published (event lost).
  Now every failure is retried with backoff and then dead-lettered.
- **Possible infinite retry loop** on repeated MongoDB write conflicts in the
  consumer; now capped.
- **Duplicate DLQ rows** when a replay failed again; DLQ entries are now upserted
  by `eventId`.
- **Failure-injector leak:** failures armed for a transaction that then aborted
  are now disarmed.
- **Session handling:** `endSession()` is awaited exactly once in a `finally`.
- **Relay ordering:** outbox rows are sorted by `createdAt, sequence` so same-millisecond
  events are not delivered out of order (the consumer drops stale sequences).
- **Startup:** collections/indexes are built (`Model.init()`) before serving traffic.
- **API hygiene:** malformed JSON now returns 400 (was 500); `Idempotency-Key` capped
  at 255 chars; idempotency keys expire after 24h (TTL index); optional `CORS_ORIGIN`
  allow-list; graceful Mongo disconnect on shutdown; `.dockerignore` files added.

### Known simplifications (documented, not hidden)

- The in-memory `BrokerQueue` lives in the API process. If the process crashes after
  the relay marks a row published but before the consumer handles it, that event is
  lost. A real broker (Kafka/SQS) or a "mark published only after consumer ack"
  scheme fixes this.
- Out-of-order events are *dropped* (not buffered), so a late seq 2 after seq 3 never
  reaches the audit log.
- Money is stored as floating-point `Number`; use integer minor units (cents) in production.

## Scaling this to production

- **Broker** — replace `services/broker.js`'s in-memory queue with a Kafka
  producer/consumer or an SQS client. `services/consumer.js`'s
  `processEvent()` already takes a plain event object and is
  broker-agnostic, so this is a localized change.
- **Horizontal scaling** — partition the Kafka topic (or SQS message group)
  by `account_id` so all events for one account go to one consumer,
  preserving the ordering guarantee the sequence-number check depends on.
- **Dedup at higher throughput** — `ProcessedEvent` works well at moderate
  scale; for very high throughput, a Redis `SETNX` with a TTL ahead of the
  DB write is the standard next step.
- **MongoDB** — swap the single-node replica set for a proper multi-node
  replica set or a sharded cluster (sharded by `account_id`) with zero
  application code changes.

## Why this project (resume / interview context)

This demonstrates understanding of problems that separate "wrote a CRUD
API" from "understands distributed systems": at-least-once vs exactly-once
delivery, the transactional outbox pattern, optimistic concurrency control,
idempotency keys, and dead-letter handling — with tests that actually
prove the guarantees under duplication, out-of-order delivery, injected
failures, and real concurrent load, rather than just asserting the happy
path. The React dashboard turns those proofs into something you can *show*
in an interview instead of only describing.

Talking points if asked about it:
- Why MongoDB transactions require a replica set, and what that means
  operationally.
- Why the dedup table's primary key *is* the race-resolution mechanism
  (no separate lock needed) — and where that stops scaling.
- The difference between the OCC retry loop (client-visible, synchronous)
  and the outbox/consumer retry loop (background, asynchronous), and why
  each needed a different failure-handling strategy.
- Why an idempotency key check and a sequence-number check solve two
  *different* problems (client retries vs. broker redelivery) even though
  they look similar.
