import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'smol-toml';

export function absolutePath(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}: required`);
  const result = value === '~' ? homedir() : /^~[/\\]/.test(value) ? join(homedir(), value.slice(2)) : value;
  if (!isAbsolute(result)) throw new Error(`${label}: absolute path required`);
  return result;
}

export function defaults() {
  return { version: 1, command: 'kimi', kimiHome: process.env.KIMI_CODE_HOME || join(homedir(), '.kimi-code'),
    bindings: [{ id: 'kimi-k3', label: 'Kimi K3', model: 'kimi-code/k3', harness: 'kimi-code' }] };
}

export function validateSettings(input, harnessIds = ['kimi-code']) {
  if (!input || input.version !== 1) throw new Error('Unsupported settings version');
  if (typeof input.command !== 'string' || !input.command.trim() || /[\r\n\0]/.test(input.command)) throw new Error('Invalid executable');
  if (/[\\/]/.test(input.command) && !isAbsolute(input.command)) throw new Error('Executable must be absolute or a PATH name');
  const kimiHome = absolutePath(input.kimiHome, 'Kimi home');
  if (!Array.isArray(input.bindings) || !input.bindings.length || input.bindings.length > 100) throw new Error('Configure 1–100 model bindings');
  const ids = new Set();
  const bindings = input.bindings.map(b => {
    if (!b || typeof b.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(b.id) || ids.has(b.id)) throw new Error('Invalid or duplicate binding id');
    ids.add(b.id);
    if (!harnessIds.includes(b.harness)) throw new Error('Unknown harness');
    for (const key of ['label', 'model']) if (typeof b[key] !== 'string' || !b[key].trim() || b[key].length > 200) throw new Error(`Invalid ${key}`);
    return { id: b.id, label: b.label.trim(), model: b.model.trim(), harness: b.harness };
  });
  return { version: 1, command: input.command.trim(), kimiHome, bindings };
}

export class SettingsStore {
  constructor(file) { this.file = file; this.queue = Promise.resolve(); }
  async read() {
    try { return validateSettings(JSON.parse(await readFile(this.file, 'utf8')), this.harnessIds?.()); }
    catch (error) { if (error.code === 'ENOENT') return defaults(); throw error; }
  }
  save(value) {
    const next = validateSettings(value, this.harnessIds?.());
    const job = this.queue.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      await rename(temp, this.file);
      return next;
    });
    this.queue = job.catch(() => {}); // Keep subsequent writes usable; the caller receives this failure.
    return job;
  }
}

/** Return only public model metadata; credentials and provider headers never leave the Host. */
export async function readModels(kimiHome) {
  const document = parse(await readFile(join(absolutePath(kimiHome, 'Kimi home'), 'config.toml'), 'utf8'));
  return Object.entries(document.models || {}).map(([alias, model]) => ({
    alias, model: String(model.model || ''), label: String(model.display_name || alias),
  }));
}
