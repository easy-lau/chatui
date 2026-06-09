// Simple concurrency limiter — prevents upstream request floods
class ConcurrencyLimiter {
  constructor(max) {
    this.max = Math.max(1, Number(max) || 50);
    this.running = 0;
    this.queue = [];
  }

  acquire() {
    if (this.running < this.max) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise(resolve => {
      this.queue.push(resolve);
    });
  }

  release() {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
  }

  get pending() { return this.queue.length; }
  get active() { return this.running; }
}

const MAX_UPSTREAM_CONCURRENCY = Number(process.env.MAX_UPSTREAM_CONCURRENCY || 30);
const limiter = new ConcurrencyLimiter(MAX_UPSTREAM_CONCURRENCY);

module.exports = { limiter, ConcurrencyLimiter };
