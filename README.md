# Caygnus — Resumable Realtime Conversation

A focused implementation of **Problem 1: Resumable Realtime Conversation** from the Caygnus Product Engineering Challenge.

## What this demonstrates

- Stable conversation, user-message, and run identifiers.
- Durable, server-owned monotonically increasing event sequences.
- Server-Sent Events (SSE) for live server-to-client streaming.
- Cursor-based replay after a dropped connection.
- Client-side duplicate suppression and gap detection.
- Explicit `running`, `completed`, and `failed` run states.
- Deterministic fake generation and deterministic failure injection.
- Durable state across service restarts.
- A reproducible 40-event verification benchmark.
- Idempotent repeated submission using the stable client message identifier.

## Stack

- Node.js built-in HTTP server
- Dependency-free durable JSON event store
- Browser `EventSource` / SSE
- Node.js built-in test runner

The prototype intentionally has no npm runtime dependencies. This keeps reviewer setup small and makes the protocol implementation easy to inspect.

## Prerequisites

Node.js 20+ recommended. The implementation was verified with Node.js 22.

## Run

```bash
npm test
npm run benchmark
npm start
```

Then open:

```text
http://localhost:3001
```

The same Node process serves the client and API.

## Configuration

Optional environment variables:

```text
PORT=3001
EVENT_COUNT=40
EVENT_DELAY_MS=120
FAIL_AFTER=
DB_FILE=./server/data/store.json
```

Example failure run:

```bash
FAIL_AFTER=5 npm start
```

This emits five text events and then records a deterministic generator failure.

## API

### Create a user message and run

```http
POST /api/conversations/:conversationId/messages
Content-Type: application/json

{
  "messageId": "message-1",
  "content": "hello"
}
```

The response contains a stable `runId`.

### Read run state

```http
GET /api/runs/:runId
```

### Resume the event stream

```http
GET /api/runs/:runId/events?after=12
```

The `after` value is the highest event sequence the client has successfully applied. The server returns only events after that cursor.

### Inspect durable history

```http
GET /api/runs/:runId/events/history
```

## Protocol design

Each run has a server-owned monotonically increasing sequence:

```text
(runId, seq)
```

An event looks like:

```json
{
  "runId": "run_...",
  "seq": 17,
  "type": "text_delta",
  "payload": { "text": "chunk-17 " }
}
```

The client cursor means **the highest event sequence already applied to visible client state**.

On reconnect, the client requests events after that cursor.

### Replay/live handoff

The SSE handler subscribes to live events **before** taking its replay high-water mark.

```text
subscribe
   ↓
take boundary N
   ↓
replay persisted events cursor+1 ... N
   ↓
flush live events generated after N
```

Events generated during replay are buffered temporarily. This prevents a race in which an event is generated between reading history and attaching the live stream.

The browser also performs defensive sequence validation:

- `seq <= cursor` → duplicate, ignore.
- `seq === cursor + 1` → apply.
- `seq > cursor + 1` → gap, reconnect instead of pretending the client is current.

## Restart semantics

The event store survives process restart because it is persisted to `server/data/store.json` using atomic temporary-file replacement.

The generator itself does **not** resume after a process restart. On startup, any run still marked `running` is transitioned to terminal `failed` with:

```text
SERVICE_INTERRUPTED
```

Previously persisted events remain inspectable and replayable.

This is an intentional and documented interruption policy rather than pretending that generation completed.

## Failure semantics

A generator failure after partial output creates a terminal `failed` event. The run cannot later transition to `completed` because terminal transitions are only accepted while the run is `running`.

The event history therefore remains useful for diagnosing what was generated before the failure.

## Tests

```bash
npm test
```

The deterministic tests cover:

- ordered live event delivery
- replay after a cursor
- replay/live deduplication
- partial generator failure
- restart interruption recovery
- stable message-id idempotency
- explicit invalid/ahead cursor handling

No test calls a paid model or waits for arbitrary long periods.

## Verification benchmark

```bash
npm run benchmark
```

The benchmark generates **40 ordered text events plus one terminal completion event**, for 41 logical events.

It simulates an active connection interruption after the client has acknowledged part of the stream. Generation continues while disconnected. The client then reconstructs the response from its cursor and intentionally receives a few duplicate deliveries to exercise client-side deduplication.

A successful benchmark reports:

```text
Expected events:        41
Applied unique events:   41
Missing events:          0
Client duplicate drops: 3
Ordering violations:    0
Final run state:        completed
Benchmark: PASS ✓
```

The duplicate drops are intentionally injected delivery duplicates; they are not duplicate events in the reconstructed response.

## Demo path

1. Run `npm start`.
2. Open `http://localhost:3001`.
3. Start a reply.
4. Observe the cursor and connection status.
5. While events are streaming, click **Simulate interruption**. The client closes the SSE connection while preserving its cursor, then automatically reconnects after a short bounded delay.
6. Observe the server continue generating events during the interruption and the client replay the missing events from its cursor.
7. Run `npm run benchmark`.
8. For failure recovery, stop the server and restart it while a run is active. The run becomes `failed` with `SERVICE_INTERRUPTED` while its existing events remain available.
9. For deterministic generator failure, use `FAIL_AFTER=5 npm start`.

## Scope intentionally omitted

Authentication, authorization, multiple simultaneous assistant runs per conversation, user cancellation, production multi-server coordination, real model providers, infinite event retention, and production observability are outside the focused prototype.

## Production considerations

A production version would replace the local JSON store with a transactional durable database, introduce explicit event retention/compaction, use a shared event fan-out mechanism for multiple application instances, add authentication, bounded reconnect backoff with jitter, metrics, tracing, and a documented policy for cursors older than retained history.

## Windows reconnect note

The local durable store uses a unique temporary snapshot file and a short bounded retry around the final rename. This avoids transient Windows `EPERM`/`EBUSY` failures when the JSON file is briefly held by an antivirus/indexing process during active streaming and reconnect activity. The store still fails loudly if the filesystem error persists.

The demo generator uses an intentionally visible delay so a reviewer can interrupt the browser connection while events are being generated. The benchmark uses its own shorter deterministic delay.
