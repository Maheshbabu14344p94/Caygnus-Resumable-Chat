# Product Engineering Challenge Submission

## Candidate

- **Name:** Mahesh Babu Singampalli
- **Email:** [ADD EMAIL]
- **GitHub:** [ADD GITHUB]
- **Selected problem:** Problem 1 — Resumable Realtime Conversation
- **Demo video:** [ADD DEMO VIDEO]

## Run the project

### Prerequisites

- Node.js 20+ recommended
- npm

### Install

No runtime npm dependencies are required. The repository can be run directly after cloning.

```bash
npm test
npm run benchmark
npm start
```

Open `http://localhost:3001`.

### Deterministic failure scenario

```bash
FAIL_AFTER=5 npm start
```

The fake generator emits five text events and then fails. The partial history remains durable and the run becomes `failed`.

## Run the tests

```bash
npm test
```

The test suite uses Node's built-in test runner and does not call a paid model API.

## Acceptance scenarios and verification

### AC1 — Ordered live stream

Implemented with server-owned monotonically increasing event sequences. The browser applies events in sequence and reaches `completed` for a successful run.

### AC2 — Missed-event recovery

The browser maintains the highest successfully applied sequence as its cursor. The demo UI includes a **Simulate interruption** control that closes the SSE connection while preserving that cursor; after a short bounded delay it reconnects and requests events after the saved cursor.

### AC3 — Replay/live overlap

The SSE route subscribes before taking its replay boundary. Events generated concurrently with replay are buffered until the replay boundary has been sent. The browser additionally ignores duplicate sequence numbers and detects gaps.

### AC4 — Service restart

Run state and events are persisted in `server/data/store.json`. The generator itself is not resumed. Any run left `running` during process shutdown is marked `failed` with `SERVICE_INTERRUPTED` on the next process start. Existing events remain replayable.

### AC5 — Generation failure

The deterministic generator can fail after a configured number of chunks. Partial output remains durable and a terminal `failed` event is recorded. Terminal state prevents a later successful transition.

### AC6 — Unknown or stale cursor

Invalid negative cursors and cursors ahead of the durable server cursor receive an explicit recoverable HTTP error. This prototype retains all event history, so it does not expire old cursors; production retention would add an explicit history-unavailable response for expired cursors.

### Verification benchmark

Run:

```bash
npm run benchmark
```

Observed verification from the development run:

```text
Expected events:        41
Observed deliveries:    44
Applied unique events:   41
Missing events:          0
Raw duplicate delivery: 3
Client duplicate drops: 3
Ordering violations:    0
Final run state:        completed
Benchmark: PASS ✓
```

The benchmark intentionally injects three duplicate deliveries after replay. The client drops all three, so the reconstructed response contains exactly 41 logical events with no missing or duplicate displayed events.

## Architecture and data flow

```text
┌──────────────────────────┐
│ Browser client            │
│                           │
│ Chat UI                   │
│ Cursor                    │
│ Connection state          │
│ Gap detection             │
│ Deduplication             │
└────────────┬─────────────┘
             │ HTTP + SSE
             ▼
┌──────────────────────────┐
│ Node HTTP service         │
│                           │
│ Message API               │
│ RunService                │
│ SseHub                    │
│ FakeGenerator             │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ Durable EventStore        │
│                           │
│ conversations             │
│ messages                  │
│ runs                      │
│ ordered run_events        │
└──────────────────────────┘
```

### Responsibilities

**Browser client**

- Owns visible UI state and the current cursor.
- Applies events in sequence.
- Ignores replay duplicates.
- Detects gaps and reconnects.
- Shows connected, reconnecting, disconnected, completed, and failed states.

**RunService**

- Creates stable run IDs.
- Coordinates deterministic generation.
- Persists events before publishing them.
- Owns generation-to-terminal-state behavior.

**EventStore**

- Owns durable run state and event history.
- Owns server event sequence assignment.
- Supports replay after a cursor.
- Recovers interrupted runs after process restart.

**SseHub**

- Owns only transient connected listeners.
- Does not act as the durable source of truth.

## Technology choices

### Node.js built-in HTTP

The service uses Node's built-in HTTP API rather than adding a web framework. The exercise is small enough that the framework would add more setup than value. Keeping the HTTP and SSE protocol visible also makes the recovery behavior easy to inspect.

### SSE

SSE was selected because the primary realtime flow is server-to-client. User messages are submitted through normal HTTP, while generated response events travel through the SSE stream. WebSockets would work but are unnecessary for this focused requirement.

### Durable JSON event store

A local JSON store with atomic temporary-file replacement was selected to keep the prototype dependency-free and extremely easy for a reviewer to run. This is deliberately a single-process prototype, not a claim that JSON files are an appropriate production event database.

### Deterministic fake generator

The generator provides predictable event counts, text chunks, timing, and failure points. This makes the benchmark and tests repeatable without a paid model provider.

## Important decisions

### 1. Server-owned ordering

The server assigns the sequence number. Clients do not invent ordering positions. `(runId, seq)` identifies a logical event position.

### 2. Durable history is separate from live delivery

A connection can disappear without deleting generated events. The event store is the source of truth; SSE is only a delivery channel.

### 3. Explicit restart interruption policy

The fake generator's execution context is not persisted. A process restart therefore does not claim that an in-progress generation resumed. Instead, a run left `running` becomes `failed` with `SERVICE_INTERRUPTED`, while its partial history remains available.

## Assumptions and limitations

- One assistant run per conversation is assumed.
- Authentication and authorization are outside scope.
- All event history is retained in this prototype.
- There is one service process and one local durable store.
- The generator is deterministic and stands in for a model provider.
- The browser client uses bounded reconnect delay rather than a production-grade jittered backoff policy.

## Production and scale

The first production changes would be:

1. Replace the JSON store with a transactional database.
2. Add event retention/compaction and an explicit expired-cursor response.
3. Introduce shared event fan-out for multiple service instances.
4. Add authentication and authorization.
5. Add reconnect jitter and operational metrics.
6. Add tracing around run lifecycle, replay latency, connection drops, and generator failures.

These are proposed improvements and are not claimed as capabilities of the submitted prototype.

## AI usage

AI tools were used during development for architecture exploration, implementation assistance, test-case review, and documentation review. Generated output was reviewed and validated by running the deterministic test suite and verification benchmark. The submitted behavior and code remain the candidate's responsibility.

## Credibility note

### Previously shipped system

[ADD PROJECT/SYSTEM]

### Problem it solved

[ADD DESCRIPTION]

### Personal contribution

[ADD YOUR CONTRIBUTION]

### Scale / operational complexity

[ADD CONCRETE SCALE OR CONSTRAINT]

### Difficult engineering decision

[ADD DECISION / INCIDENT / TRADE-OFF]

### Evidence

[ADD PUBLIC LINK OR OTHER EVIDENCE]
