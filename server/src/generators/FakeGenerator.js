export class FakeGenerator {
  constructor({ count = 40, delayMs = 80, failAfter = null } = {}) {
    this.count = count;
    this.delayMs = delayMs;
    this.failAfter = failAfter;
  }
  async *generate() {
    for (let i = 1; i <= this.count; i += 1) {
      if (this.failAfter !== null && i > this.failAfter) throw new Error(`DETERMINISTIC_GENERATOR_FAILURE_AFTER_${this.failAfter}`);
      if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      yield `chunk-${String(i).padStart(2, '0')} `;
    }
  }
}
