// Game-clock scheduler: tweens, waits and conditions that advance only while the game runs.
// Pausing the game simply stops calling update(), so every sequence freezes in place.
// cancelAll() rejects everything pending with a Cancelled error, which unwinds async sequences
// (used by Restart / Quit / Skip intro).

export class Cancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'Cancelled';
  }
}

export const isCancel = (e) => e && e.name === 'Cancelled';

export class Scheduler {
  constructor() {
    this.time = 0;
    this.tasks = new Set();
    this.epoch = 0;
  }

  update(dt) {
    this.time += dt;
    if (!this.tasks.size) return;
    for (const t of Array.from(this.tasks)) {
      if (!this.tasks.has(t)) continue;
      t.elapsed += dt;
      if (t.until) {
        let done = false;
        try {
          done = t.until();
        } catch (e) {
          console.error(e);
          done = true;
        }
        if (done) {
          this.tasks.delete(t);
          t.resolve();
        }
        continue;
      }
      if (t.duration === Infinity) continue;
      const raw = t.duration > 0 ? Math.min(1, t.elapsed / t.duration) : 1;
      if (t.fn) {
        try {
          t.fn(t.ease ? t.ease(raw) : raw, dt, raw);
        } catch (e) {
          console.error(e);
        }
      }
      if (raw >= 1) {
        this.tasks.delete(t);
        t.resolve();
      }
    }
  }

  /** Animate over `duration` seconds; fn(easedK, dt, rawK) is called every frame including k = 1. */
  tween(duration, fn, ease) {
    return new Promise((resolve, reject) => {
      this.tasks.add({ duration: Math.max(0, duration), fn, ease, elapsed: 0, resolve, reject });
    });
  }

  wait(duration) {
    return this.tween(duration, null);
  }

  /** Resolve once predicate() returns true (checked each frame). */
  until(predicate) {
    return new Promise((resolve, reject) => {
      this.tasks.add({ until: predicate, elapsed: 0, resolve, reject });
    });
  }

  /** Wrap an external promise (e.g. a button press) so it is cancelled with everything else. */
  waitFor(promise) {
    return new Promise((resolve, reject) => {
      const task = { duration: Infinity, elapsed: 0, resolve: () => {}, reject };
      this.tasks.add(task);
      promise.then(
        (v) => {
          if (this.tasks.has(task)) {
            this.tasks.delete(task);
            resolve(v);
          }
        },
        (e) => {
          if (this.tasks.has(task)) {
            this.tasks.delete(task);
            reject(e);
          }
        },
      );
    });
  }

  /** Run several async branches in parallel. */
  all(...promises) {
    return Promise.all(promises);
  }

  cancelAll() {
    const pending = Array.from(this.tasks);
    this.tasks.clear();
    this.epoch++;
    for (const t of pending) t.reject(new Cancelled());
  }
}
