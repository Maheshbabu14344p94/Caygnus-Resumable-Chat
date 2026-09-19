import crypto from 'node:crypto';

export class RunService {
  constructor({ store, hub, generatorFactory }) {
    this.store = store;
    this.hub = hub;
    this.generatorFactory = generatorFactory;
    this.active = new Map();
  }
  id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }

  createRun({ conversationId, userMessageId, content }) {
    const now = new Date().toISOString();
    this.store.createConversation(conversationId, now);
    const existing = this.store.getMessage(userMessageId);
    if (existing) {
      const existingRun = this.store.getRunByMessage(userMessageId);
      if (existingRun) return existingRun;
      throw new Error('MESSAGE_ID_REUSED');
    }
    this.store.createMessage({ id: userMessageId, conversationId, role: 'user', content, createdAt: now });
    const run = {
      id: this.id('run'), conversationId, userMessageId, status: 'running',
      createdAt: now, updatedAt: now, lastSeq: 0, error: null
    };
    this.store.createRun(run);
    this.start(run.id);
    return this.store.getRun(run.id);
  }

  start(runId) {
    if (this.active.has(runId)) return;
    const task = this.generate(runId).finally(() => this.active.delete(runId));
    this.active.set(runId, task);
  }

  async generate(runId) {
    try {
      const generator = this.generatorFactory(runId);
      for await (const text of generator.generate()) {
        const run = this.store.getRun(runId);
        if (!run || run.status !== 'running') return;
        const event = this.store.appendEvent(runId, 'text_delta', { text });
        this.hub.publish(event);
      }
      const result = this.store.transitionTerminal(runId, 'completed');
      if (result.event) this.hub.publish(result.event);
    } catch (error) {
      const result = this.store.transitionTerminal(runId, 'failed', error.message);
      if (result.event) this.hub.publish(result.event);
    }
  }
  getRun(id) { return this.store.getRun(id); }
  events(id, after, through) { return this.store.eventsAfter(id, after, through); }
}
