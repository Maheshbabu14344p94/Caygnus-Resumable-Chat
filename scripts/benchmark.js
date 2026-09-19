import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventStore } from '../server/src/store/EventStore.js';
import { SseHub } from '../server/src/services/SseHub.js';
import { RunService } from '../server/src/services/RunService.js';
import { FakeGenerator } from '../server/src/generators/FakeGenerator.js';
import { createServer } from '../server/src/server.js';

const dbPath = path.join(os.tmpdir(), `caygnus-benchmark-${process.pid}.json`);
for (const file of fs.readdirSync(path.dirname(dbPath))) { if (file.startsWith(path.basename(dbPath))) fs.rmSync(path.join(path.dirname(dbPath), file), { force: true }); }

const store = new EventStore(dbPath);
const hub = new SseHub();
const service = new RunService({
  store,
  hub,
  generatorFactory: () => new FakeGenerator({ count: 40, delayMs: 3 })
});
const server = createServer({ runService: service, store, hub, clientDir: path.resolve('client') });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

function parseSseChunk(buffer, onEvent) {
  const blocks = buffer.split('\n\n');
  const remainder = blocks.pop();
  for (const block of blocks) {
    const dataLine = block.split('\n').find((line) => line.startsWith('data: '));
    if (dataLine) onEvent(JSON.parse(dataLine.slice(6)));
  }
  return remainder;
}

async function waitForRun(runId) {
  const start = Date.now();
  while (service.getRun(runId).status === 'running') {
    if (Date.now() - start > 5000) throw new Error('Benchmark timed out waiting for run');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

const createResponse = await fetch(`${base}/api/conversations/benchmark/messages`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ messageId: 'benchmark-message', content: 'benchmark' })
});
const { runId } = await createResponse.json();

let cursor = 0;
const firstResponse = await fetch(`${base}/api/runs/${runId}/events?after=0`);
let buffer = '';
  const reader = firstResponse.body.getReader();
  let disconnectRequested = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += new TextDecoder().decode(value, { stream: true });
    buffer = parseSseChunk(buffer, (event) => {
      if (event.seq === cursor + 1) cursor = event.seq;
      if (event.seq === 12) disconnectRequested = true;
    });
    if (disconnectRequested) {
      await reader.cancel('simulated connection interruption');
      break;
    }
  }

await waitForRun(runId);

const replayResponse = await fetch(`${base}/api/runs/${runId}/events?after=${cursor}`);
assertOk(replayResponse);
let replayBuffer = '';
const replayEvents = [];
const replayReader = replayResponse.body.getReader();
let terminalSeen = false;
while (true) {
  const { value, done } = await replayReader.read();
  if (done) break;
  replayBuffer += new TextDecoder().decode(value, { stream: true });
  replayBuffer = parseSseChunk(replayBuffer, (event) => { replayEvents.push(event); if (event.type === 'completed' || event.type === 'failed') terminalSeen = true; });
  if (terminalSeen) { await replayReader.cancel('terminal event observed'); break; }
}

// Reconstruct exactly as the browser does: apply only the next expected sequence.
const received = Array.from({ length: cursor }, (_, i) => i + 1).concat(replayEvents.map((e) => e.seq));
const injectedDuplicates = replayEvents.slice(0, 3).map((e) => e.seq);
received.push(...injectedDuplicates);
let appliedCursor = 0;
const applied = [];
let duplicateDrops = 0;
for (const seq of received) {
  if (seq <= appliedCursor) { duplicateDrops += 1; continue; }
  if (seq !== appliedCursor + 1) throw new Error(`Gap during reconstruction: expected ${appliedCursor + 1}, got ${seq}`);
  applied.push(seq);
  appliedCursor = seq;
}

const expected = Array.from({ length: 41 }, (_, i) => i + 1);
const missing = expected.filter((seq) => !applied.includes(seq));
const rawDuplicateDeliveries = received.length - new Set(received).size;
const orderingViolations = applied.some((seq, index) => seq !== expected[index]);
const state = service.getRun(runId).status;
const pass = missing.length === 0 && applied.length === expected.length && duplicateDrops === rawDuplicateDeliveries && orderingViolations === false && state === 'completed';

console.log('\n=== Caygnus Resumable Streaming Benchmark ===');
console.log(`Run:                    ${runId}`);
console.log(`Expected events:        ${expected.length}`);
console.log(`Observed deliveries:    ${received.length}`);
console.log(`Applied unique events:  ${applied.length}`);
console.log(`Missing events:         ${missing.length}`);
console.log(`Raw duplicate delivery:${String(rawDuplicateDeliveries).padStart(3)}`);
console.log(`Client duplicate drops: ${duplicateDrops}`);
console.log(`Ordering violations:    ${orderingViolations ? 1 : 0}`);
console.log(`Final run state:        ${state}`);
console.log(`Benchmark: ${pass ? 'PASS ✓' : 'FAIL ✗'}`);

server.close();
for (const file of fs.readdirSync(path.dirname(dbPath))) { if (file.startsWith(path.basename(dbPath))) fs.rmSync(path.join(path.dirname(dbPath), file), { force: true }); }
if (!pass) process.exit(1);

function assertOk(response) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
