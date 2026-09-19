# Product Engineering Challenge Submission

## Candidate

-   **Name:** - Mahesh Babu Singampalli
-   **Email:** - singampallimaheshbabu@gmail.com
-   **GitHub:** -  https://github.com/Maheshbabu14344p94
-   **Selected problem:** - Problem 1 --- Resumable Realtime Conversation
-   **Demo video:** - (https://www.loom.com/share/7eee3b8e6aad4a4ea02678f01e2cf6bd)

------------------------------------------------------------------------

## Run the project

### Prerequisites

-   Node.js
-   npm

### Install dependencies

``` powershell
npm install
```

### Start the service

``` powershell
npm start
```

The service starts at:

``` text
http://localhost:3001
```

Open that URL in a browser to use the demo client.

### Successful scenario

1.  Start the service with `npm start`.
2.  Open `http://localhost:3001`.
3.  Click **Start reply**.
4.  The deterministic response streams through SSE.
5.  The client displays the run ID, cursor, event count, and connection
    state.
6.  The run reaches `Completed` at cursor 41.

### Interruption/recovery scenario

1.  Start a new reply.
2.  While the response is streaming, click **Simulate interruption**.
3.  The client closes the current SSE connection while retaining its
    cursor.
4.  The server continues generating and persisting events.
5.  The client reconnects using the last cursor.
6.  Events after that cursor are replayed and then live delivery
    continues.
7.  The response eventually reaches `Completed` without displaying
    duplicate logical events.

The demonstrated run was interrupted at cursor 11 and later at cursor 34
before completing.

------------------------------------------------------------------------

## Run the tests

``` powershell
npm test
```

### Observed result

``` text
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

All 9 automated tests passed.

The tests cover:

-   Ordered live delivery
-   Replay after a cursor
-   Replay/live overlap
-   Complete replay after a cursor
-   Client deduplication
-   Generator failure after partial output
-   Service restart recovery
-   Idempotent message submission
-   Explicit rejection of a cursor ahead of the durable server cursor

------------------------------------------------------------------------

## Acceptance scenarios and verification

### AC1 --- Ordered live stream

**Status: Complete**

Each generated event has a server-defined sequence number. The client
accepts events only when the next sequence is exactly the previous
cursor plus one.

The browser demo showed:

``` text
SSE connected
...
Cursor: 41
Events: 41
run completed
```

The final displayed response contained `chunk-01` through `chunk-40` in
order.

### AC2 --- Missed-event recovery

**Status: Complete**

The client reconnects using its last applied cursor. Events generated
while the SSE connection is unavailable remain in durable event history
and are replayed after reconnection.

The demo showed:

``` text
DEMO: intentionally interrupting SSE at cursor 11
DEMO: reconnecting from cursor 11
SSE connected
```

and later:

``` text
DEMO: intentionally interrupting SSE at cursor 34
DEMO: reconnecting from cursor 34
SSE connected
```

The same run subsequently completed at cursor 41.

### AC3 --- Replay/live overlap

**Status: Complete**

Replay and live events share the same server-owned sequence space. The
client rejects sequence numbers at or below its cursor and rejects gaps
rather than silently accepting an incomplete stream.

The automated replay/live overlap and deduplication tests pass.

### AC4 --- Service restart

**Status: Complete**

Run state and event history are stored durably. If the service restarts
while generation is in progress, the prototype transitions the
in-progress run to an explicit interrupted state rather than pretending
that generation completed. Previously persisted events remain
inspectable.

This behavior is covered by the restart recovery test.

### AC5 --- Generation failure

**Status: Complete**

The deterministic generator can fail after partial output. The partial
event history remains durable, the run becomes failed, and a failed run
cannot later become completed.

Covered by the generator-failure test.

### AC6 --- Unknown or stale cursor

**Status: Complete**

The service explicitly rejects a cursor that is ahead of the durable
server cursor instead of silently skipping content.

Covered by the HTTP cursor-validation test.

------------------------------------------------------------------------

## Verification benchmark

Run:

``` powershell
npm run benchmark
```

### Observed result

``` text
=== Caygnus Resumable Streaming Benchmark ===
Run:                    run_41b96eaf-d8e4-43fb-a187-1070a5cdd916
Expected events:        41
Observed deliveries:    44
Applied unique events:  41
Missing events:         0
Raw duplicate delivery: 3
Client duplicate drops: 3
Ordering violations:    0
Final run state:        completed
Benchmark: PASS ✓
```

The benchmark intentionally produces three duplicate deliveries. Those
duplicate deliveries are dropped by the client.

The correctness result is therefore:

``` text
Expected events:        41
Applied unique events:  41
Missing events:         0
Client duplicate drops: 3
Ordering violations:    0
Final run state:        completed
```

------------------------------------------------------------------------

## Architecture and data flow

``` text
                         Browser Client
                              |
                              | POST message
                              v
                     +-------------------+
                     |   Run / API       |
                     |     Service       |
                     +---------+---------+
                               |
                               | create/run
                               v
                     +-------------------+
                     | Deterministic     |
                     | Generator         |
                     +---------+---------+
                               |
                               | ordered events
                               v
                     +-------------------+
                     | Durable Event     |
                     | Store             |
                     |                   |
                     | Run state         |
                     | Event history     |
                     | Message identity  |
                     +---------+---------+
                               ^
                               |
                         replay / live
                               |
                         SSE connection
                               |
                               v
                     +-------------------+
                     | Browser Client    |
                     |                   |
                     | Cursor            |
                     | Deduplication     |
                     | Gap detection     |
                     | Connection state  |
                     +-------------------+
```

### Main responsibilities

#### Client

-   Starts a run through the HTTP API.
-   Opens an SSE connection for the run.
-   Tracks the highest successfully applied event sequence.
-   Detects duplicate events.
-   Detects sequence gaps.
-   Reconnects from the current cursor.
-   Displays connection and terminal states.
-   Reconstructs the response from ordered text events.

#### Run service

-   Creates and manages stable run identifiers.
-   Coordinates generation.
-   Owns run lifecycle transitions.
-   Prevents terminal states from becoming successful after
    failure/interruption.

#### Durable store

-   Stores run state.
-   Stores ordered event history.
-   Provides replay after a cursor.
-   Preserves state across service restart.

#### Deterministic generator

-   Produces a fixed sequence of text events.
-   Can be configured for deterministic failure scenarios.
-   Does not call a paid model API.

#### SSE delivery

-   Provides transient server-to-client streaming.
-   Is not treated as the source of truth.
-   Can disappear and be recreated without losing durable events.

------------------------------------------------------------------------

## Technology choices

### Node.js

Chosen for a small asynchronous service with minimal setup.

### Server-Sent Events

SSE was selected because this exercise primarily requires one-way
server-to-client streaming. Normal HTTP is used to submit the user
message, while SSE handles generated response events.

This avoids introducing unnecessary bidirectional WebSocket protocol
complexity.

### Durable local store

The prototype uses a local durable store so the reviewer can reproduce
restart and recovery behavior without installing a separate database
service.

### Deterministic generator

A deterministic fake generator makes tests and the benchmark repeatable
without a live model or paid provider.

------------------------------------------------------------------------

## Important decisions

### 1. Server-owned ordering

The server owns the event sequence. Each run has a monotonically
increasing sequence position.

The client cursor means:

> the highest event sequence that the client has successfully applied.

The client never invents sequence positions.

### 2. Durable history is separate from the connection

An SSE connection is transient. The event store is the source of truth.

Therefore:

``` text
connection lost
       ≠
events lost
```

The generator can continue producing events while the client is
disconnected, and the client can later replay them.

### 3. Explicit terminal states

Runs have explicit terminal outcomes.

A run that failed or was interrupted cannot later be represented as
successfully completed.

For an in-progress generation at service restart, this prototype chooses
an explicit interrupted state rather than attempting to resume arbitrary
generator execution.

------------------------------------------------------------------------

## Replay and live delivery

The client sends its last applied cursor when opening the SSE stream:

``` text
GET /api/runs/<runId>/events?after=<cursor>
```

The durable store supplies events after that cursor.

The same sequence space is used for replayed and newly generated events.
The client therefore has one deterministic ordering rule for both paths.

Client-side protections include:

1.  Duplicate sequence numbers are ignored.
2.  A sequence gap is detected.
3.  The client reconnects from its known cursor rather than silently
    advancing.
4.  Terminal events close the stream.

------------------------------------------------------------------------

## Failure and recovery behavior

### Connection failure

The connection is treated as transient. The client enters reconnecting
state and retries with a bounded delay.

### Generator failure

Partial history remains durable. The run enters `failed` and cannot
later become `completed`.

### Service restart

Persisted runs and events survive. An active generation that cannot
itself be reconstructed becomes explicitly interrupted rather than
falsely completed.

### Invalid cursor

The server returns an explicit recoverable error when it cannot safely
serve the requested cursor.

------------------------------------------------------------------------

## Assumptions and limitations

-   One assistant run is active for a conversation at a time.
-   Authentication and authorization are outside the challenge scope.
-   The generator is deterministic and local.
-   The prototype uses a single service instance.
-   The prototype does not attempt distributed ordering.
-   Event retention is not treated as infinite.
-   An in-progress generator is not reconstructed after a process crash;
    it transitions to an explicit interrupted state.
-   Multiple production servers and multi-region ordering are outside
    scope.

------------------------------------------------------------------------

## Production and scale

The submitted implementation intentionally favors correctness and
reviewer reproducibility over distributed infrastructure.

For production, I would first address:

1.  A production-grade durable database and transaction strategy.
2.  Explicit event-retention and cursor-expiration policies.
3.  Shared event delivery/coordination when multiple application
    instances are introduced.
4.  Metrics for reconnects, replay sizes, gaps, stalled runs, and
    terminal failures.
5.  Bounded reconnect backoff with jitter.
6.  Operational handling for expired cursors.
7.  Authentication and authorization.
8.  Monitoring and alerting around failed/interrupted runs.

These are proposed production changes and are not claimed as implemented
features of this prototype.

------------------------------------------------------------------------

## AI usage

AI tools were used during development for implementation brainstorming,
code review, edge-case exploration, and documentation assistance.

Generated suggestions were reviewed and tested against the deterministic
automated test suite and verification benchmark. The final behavior is
based on the submitted implementation and its observed test/benchmark
results.

------------------------------------------------------------------------

## Credibility note

### Previously shipped system

**System/project:**  A2B Digital Solutions 

### Problem it solved

Worked on a backend fintech application where the user identification model needed to be updated from internal database IDs to a business-specific employee_code. The change required updating the database schema, related table references, user APIs, and authentication-related code while preserving existing data.

### Personal contribution


My Contribution:
I worked on the database migration and backend changes, including:

1.Added employee_code as the user identifier.
2.Migrated existing users to generated employee codes such as A2B00001.
3.Updated related tables to reference employee_code.
4.Removed the previous id/avatar dependencies where required.
5.Implemented employee-code generation and uniqueness checks.
6.Updated the User entity and repository methods.
7.Tested the migration and backend behavior.
8.Worked with Git feature branches and pull-request workflow.

### Scale / operational complexity

The A2B Fintech API is a backend application with multiple related database entities and APIs. The employee-code migration affected the users table and dependent references in tables such as employees and insurance_applications. The main operational constraint was preserving existing relationships and data while changing the user identifier model. The migration therefore had to populate identifiers for existing records, update dependent references, enforce uniqueness, and remove the old identifier references in the correct order to avoid breaking existing data.

### Difficult engineering decision

A key challenge was changing the identifier used across multiple related tables without losing existing relationships. I first populated employee codes for existing records, migrated dependent references, and only then removed the old ID-based references. This reduced the risk of breaking existing data relationships during the migration.

### Evidence

The work was completed in the A2B Fintech API codebase. Relevant evidence can include the Git branch/PR, migration files, backend code changes, and test results.

------------------------------------------------------------------------

## Demo video checklist

The demo should show:

1.  Successful streamed response.
2.  Visible connected/reconnecting/disconnected/completed states.
3.  Interruption at a non-terminal cursor.
4.  Reconnection using the existing cursor.
5.  Recovery without duplicate displayed content.
6.  A generation failure or restart recovery path.
7.  `npm test` output.
8.  `npm run benchmark` output.
9.  Architecture and one important trade-off.

### Suggested demo sequence

**0:00--0:30** --- Introduce the problem and architecture.

**0:30--1:15** --- Start a deterministic reply and show ordered
streaming.

**1:15--2:00** --- Interrupt around cursor 10, reconnect, and show
recovery.

**2:00--2:30** --- Interrupt again around cursor 30 and show the same
run continuing.

**2:30--3:00** --- Show failure/restart behavior.

**3:00--3:45** --- Run tests and benchmark and explain the observed
results.

**3:45--4:15** --- Explain one trade-off and production-scale changes.

------------------------------------------------------------------------

## Final completeness checklist

Before submission:

- [x] Fork is accessible.
- [x] Problem 1 is clearly identified.
- [x] Setup and run instructions are present.
- [x] `SUBMISSION.md` is complete.
- [x] Demo video is accessible.
- [x] Relevant source code is included.
- [x] Automated tests are included and runnable.
- [x] Core acceptance scenario is demonstrated.
- [x] Failure/recovery scenario is demonstrated.
- [x] Verification benchmark has a reproducible command and observed results.
- [x] AI usage is disclosed.
- [x] Credibility note is complete.
- [x] No secrets or private credentials are committed.
