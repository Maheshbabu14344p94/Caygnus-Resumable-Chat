import fs from 'node:fs';
import path from 'node:path';

const EMPTY = { conversations: {}, messages: {}, runs: {}, events: {} };
const WINDOWS_RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY']);

function sleepSync(ms) {
  if (ms <= 0) return;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, ms);
}

export class EventStore {
  constructor(filePath) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) this.write(EMPTY);
    this.data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  /**
   * Persist a complete snapshot.
   *
   * Windows can transiently reject a rename when another process (or an
   * antivirus/indexer) briefly has the destination open. A unique temporary
   * filename plus a short bounded retry makes the local durable store much
   * more reliable during reconnect/replay activity without hiding permanent
   * filesystem failures.
   */
  write(data = this.data) {
    const temp = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    const serialized = JSON.stringify(data, null, 2);

    let fd;
    try {
      fd = fs.openSync(temp, 'w');
      fs.writeFileSync(fd, serialized, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;

      let lastError;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          fs.renameSync(temp, this.filePath);
          return;
        } catch (error) {
          lastError = error;
          if (!WINDOWS_RETRYABLE.has(error?.code)) throw error;
          sleepSync(15 * (attempt + 1));
        }
      }
      throw lastError;
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch {}
      }
      try { fs.rmSync(temp, { force: true }); } catch {}
    }
  }

  save() { this.write(); }

  createConversation(id, now = new Date().toISOString()) {
    if (!this.data.conversations[id]) {
      this.data.conversations[id] = { id, createdAt: now };
      this.save();
    }
  }

  createMessage(message) {
    if (this.data.messages[message.id]) return false;
    this.data.messages[message.id] = message;
    this.save();
    return true;
  }

  getMessage(id) { return this.data.messages[id] ?? null; }

  createRun(run) {
    this.data.runs[run.id] = { ...run, lastSeq: 0, error: null };
    this.data.events[run.id] = [];
    this.save();
  }

  getRun(id) { return this.data.runs[id] ?? null; }

  getRunByMessage(messageId) {
    return Object.values(this.data.runs).find((run) => run.userMessageId === messageId) ?? null;
  }

  appendEvent(runId, type, payload = null, { persist = true } = {}) {
    const run = this.getRun(runId);
    if (!run) throw new Error(`RUN_NOT_FOUND:${runId}`);
    if (run.status !== 'running') throw new Error(`RUN_TERMINAL:${run.status}`);
    const seq = run.lastSeq + 1;
    const event = { runId, seq, type, payload, createdAt: new Date().toISOString() };
    this.data.events[runId].push(event);
    run.lastSeq = seq;
    run.updatedAt = event.createdAt;
    if (persist) this.save();
    return structuredClone(event);
  }

  transitionTerminal(runId, status, error = null) {
    const run = this.getRun(runId);
    if (!run) throw new Error(`RUN_NOT_FOUND:${runId}`);
    if (run.status !== 'running') return { changed: false, run: structuredClone(run), event: null };

    // Persist the terminal event and terminal run state together so a
    // terminal event can never be durable while the run still appears running.
    const event = this.appendEvent(
      runId,
      status === 'completed' ? 'completed' : 'failed',
      status === 'failed' ? { error } : null,
      { persist: false }
    );
    run.status = status;
    run.error = error;
    run.updatedAt = event.createdAt;
    this.save();
    return { changed: true, run: structuredClone(run), event };
  }

  eventsAfter(runId, afterSeq, throughSeq = Infinity) {
    return (this.data.events[runId] ?? [])
      .filter((event) => event.seq > afterSeq && event.seq <= throughSeq)
      .map((event) => structuredClone(event));
  }

  allEvents(runId) { return this.eventsAfter(runId, 0); }

  recoverInterruptedRuns() {
    const ids = Object.values(this.data.runs)
      .filter((run) => run.status === 'running')
      .map((run) => run.id);
    for (const id of ids) this.transitionTerminal(id, 'failed', 'SERVICE_INTERRUPTED');
    return ids;
  }
}
