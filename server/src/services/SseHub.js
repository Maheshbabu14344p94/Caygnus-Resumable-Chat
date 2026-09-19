export class SseHub {
  constructor() { this.listeners = new Map(); }
  subscribe(runId, listener) {
    if (!this.listeners.has(runId)) this.listeners.set(runId, new Set());
    const set = this.listeners.get(runId);
    set.add(listener);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(runId);
    };
  }
  publish(event) {
    for (const listener of [...(this.listeners.get(event.runId) ?? [])]) listener(event);
  }
}
