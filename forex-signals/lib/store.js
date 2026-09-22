// Signal history, newest first, kept in one JSON file under the data dir.

import fs from 'node:fs/promises';
import path from 'node:path';

export class SignalStore {
  constructor({ dataDir, max = 500 }) {
    this.path = path.join(dataDir, 'signals.json');
    this.max = max;
    this.signals = [];
    this.writing = Promise.resolve();
  }

  async load() {
    await fs.mkdir(path.dirname(this.path), { recursive: true });
    try {
      this.signals = JSON.parse(await fs.readFile(this.path, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.signals = [];
    }
    return this;
  }

  add(signal) {
    this.signals.unshift(signal);
    if (this.signals.length > this.max) this.signals.length = this.max;
    // Writes are chained so two quick signals can't interleave on disk.
    const snapshot = JSON.stringify(this.signals);
    this.writing = this.writing.then(async () => {
      const tmp = `${this.path}.tmp`;
      await fs.writeFile(tmp, snapshot);
      await fs.rename(tmp, this.path);
    });
    return this.writing;
  }

  list({ instrument = null, limit = 50 } = {}) {
    const rows = instrument ? this.signals.filter((s) => s.instrument === instrument) : this.signals;
    return rows.slice(0, limit);
  }

  latest(instrument) {
    return this.signals.find((s) => s.instrument === instrument) || null;
  }
}
