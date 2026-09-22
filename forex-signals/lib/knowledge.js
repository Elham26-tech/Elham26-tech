// What the AI knows about trading: the built-in course rulebook (or the
// user's edited copy) and the tutorials library — PDFs, images and text the
// user uploads. Active tutorials go into every AI request as cached content
// blocks, so the library keeps to a byte and character budget.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const TYPES = {
  '.pdf': { kind: 'pdf', mime: 'application/pdf' },
  '.png': { kind: 'image', mime: 'image/png' },
  '.jpg': { kind: 'image', mime: 'image/jpeg' },
  '.jpeg': { kind: 'image', mime: 'image/jpeg' },
  '.webp': { kind: 'image', mime: 'image/webp' },
  '.gif': { kind: 'image', mime: 'image/gif' },
  '.txt': { kind: 'text', mime: 'text/plain' },
  '.md': { kind: 'text', mime: 'text/plain' },
};

export const ACCEPTED_EXTENSIONS = Object.keys(TYPES);

export class KnowledgeError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export class Knowledge {
  constructor({ root, dataDir, maxUploadBytes, maxTutorialBytes, maxTutorialChars }) {
    this.builtinPath = path.join(root, 'knowledge', 'rulebook.md');
    this.customPath = path.join(dataDir, 'rulebook.md');
    this.dir = path.join(dataDir, 'tutorials');
    this.indexPath = path.join(this.dir, 'index.json');
    this.maxUploadBytes = maxUploadBytes;
    this.maxTutorialBytes = maxTutorialBytes;
    this.maxTutorialChars = maxTutorialChars;
    this.index = [];
    this.blockCache = new Map(); // tutorial id -> content blocks
  }

  async load() {
    await fs.mkdir(this.dir, { recursive: true });
    try {
      this.index = JSON.parse(await fs.readFile(this.indexPath, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.index = [];
    }
    this.builtin = await fs.readFile(this.builtinPath, 'utf8');
    return this;
  }

  async saveIndex() {
    const tmp = `${this.indexPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.index, null, 2));
    await fs.rename(tmp, this.indexPath);
  }

  async getRulebook() {
    try {
      return { text: await fs.readFile(this.customPath, 'utf8'), custom: true };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      return { text: this.builtin, custom: false };
    }
  }

  // Empty text restores the built-in rulebook.
  async setRulebook(text) {
    if (typeof text !== 'string') throw new KnowledgeError('rulebook text is required');
    if (!text.trim()) {
      await fs.rm(this.customPath, { force: true });
      return this.getRulebook();
    }
    if (text.length > 200_000) throw new KnowledgeError('rulebook is too long (max 200,000 characters)');
    await fs.writeFile(this.customPath, text);
    return this.getRulebook();
  }

  usage(except = null) {
    let bytes = 0;
    let chars = 0;
    for (const t of this.index) {
      if (!t.active || t.id === except) continue;
      if (t.kind === 'text') chars += t.chars;
      else bytes += t.bytes;
    }
    return { bytes, chars, maxBytes: this.maxTutorialBytes, maxChars: this.maxTutorialChars };
  }

  fits(item) {
    const u = this.usage(item.id);
    return item.kind === 'text' ? u.chars + item.chars <= u.maxChars : u.bytes + item.bytes <= u.maxBytes;
  }

  list() {
    return { tutorials: this.index, usage: this.usage(), accepted: ACCEPTED_EXTENSIONS };
  }

  async add(name, buffer) {
    const clean = path.basename(String(name || '')).replace(/[\u0000-\u001f]/g, '').slice(0, 200);
    const ext = path.extname(clean).toLowerCase();
    const type = TYPES[ext];
    if (!clean || !type) throw new KnowledgeError(`unsupported file type; accepted: ${ACCEPTED_EXTENSIONS.join(' ')}`);
    if (!buffer.length) throw new KnowledgeError('file is empty');
    if (buffer.length > this.maxUploadBytes) throw new KnowledgeError('file is larger than the upload limit', 413);
    if (type.kind === 'pdf' && buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new KnowledgeError('not a PDF file');

    const item = {
      id: randomUUID(),
      name: clean,
      kind: type.kind,
      mime: type.mime,
      ext,
      bytes: buffer.length,
      chars: 0,
      active: true,
      addedAt: new Date().toISOString(),
    };
    if (type.kind === 'text') {
      const text = buffer.toString('utf8').replace(/^﻿/, '');
      item.chars = text.length;
      await fs.writeFile(path.join(this.dir, `${item.id}.txt`), text);
    } else {
      await fs.writeFile(path.join(this.dir, `${item.id}${ext}`), buffer);
    }
    // Over budget still saves the file, just inactive; the user can make room.
    if (!this.fits(item)) item.active = false;
    this.index.push(item);
    await this.saveIndex();
    return item;
  }

  async setActive(id, active) {
    const item = this.index.find((t) => t.id === id);
    if (!item) throw new KnowledgeError('tutorial not found', 404);
    if (active && !this.fits(item)) {
      throw new KnowledgeError('activating this tutorial would exceed the tutorials budget; deactivate another first', 409);
    }
    item.active = Boolean(active);
    await this.saveIndex();
    return item;
  }

  async remove(id) {
    const item = this.index.find((t) => t.id === id);
    if (!item) throw new KnowledgeError('tutorial not found', 404);
    await fs.rm(this.filePath(item), { force: true });
    this.index = this.index.filter((t) => t.id !== id);
    this.blockCache.delete(id);
    await this.saveIndex();
  }

  filePath(item) {
    return path.join(this.dir, `${item.id}${item.kind === 'text' ? '.txt' : item.ext}`);
  }

  // Content blocks for the active tutorials, in upload order so the cached
  // prefix stays stable between requests.
  async blocks() {
    const out = [];
    for (const item of this.index) {
      if (!item.active) continue;
      if (!this.blockCache.has(item.id)) {
        const data = await fs.readFile(this.filePath(item));
        let blocks;
        if (item.kind === 'text') {
          blocks = [{ type: 'document', source: { type: 'text', media_type: 'text/plain', data: data.toString('utf8') }, title: item.name }];
        } else if (item.kind === 'pdf') {
          blocks = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: data.toString('base64') }, title: item.name }];
        } else {
          blocks = [
            { type: 'text', text: `Tutorial image: ${item.name}` },
            { type: 'image', source: { type: 'base64', media_type: item.mime, data: data.toString('base64') } },
          ];
        }
        this.blockCache.set(item.id, blocks);
      }
      out.push(...this.blockCache.get(item.id));
    }
    return out;
  }
}
