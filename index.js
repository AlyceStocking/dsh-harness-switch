import { join } from 'node:path';
import { homedir } from 'node:os';
import { SettingsStore, readModels, absolutePath } from './src/settings.js';
import { KimiSession } from './src/kimi.js';

export const name = 'harness-switch';
export const inject = ['connection', 'subprocess'];

/** Host-owned model bindings and runtime lifetimes; registering another harness is additive. */
export class HarnessManager {
  constructor(store, spawn, options) {
    Object.assign(this, { store, spawn, options });
    this.harnesses = new Map(); this.sessions = new Map(); this.stopped = false;
    this.store.harnessIds = () => [...this.harnesses.keys()];
    this.register({ id: 'kimi-code', label: 'Kimi Code', create: spec => new KimiSession(spec) });
  }
  register(harness) {
    if (this.harnesses.has(harness.id)) throw new Error('Harness is already registered');
    this.harnesses.set(harness.id, harness);
    return () => { this.harnesses.delete(harness.id); };
  }
  async settings() {
    return { settings: await this.store.read(), harnesses: [...this.harnesses.values()].map(({ id, label }) => ({ id, label })) };
  }
  async start(payload) {
    if (this.stopped) throw new Error('Plugin is stopping');
    if (this.sessions.size >= this.options.maxSessions) throw new Error('Close an active session before opening another');
    const settings = await this.store.read();
    if (this.stopped) throw new Error('Plugin is stopping');
    if (this.sessions.size >= this.options.maxSessions) throw new Error('Session limit reached');
    const binding = settings.bindings.find(b => b.id === payload.bindingId);
    if (!binding) throw new Error('Unknown model binding');
    const harness = this.harnesses.get(binding.harness);
    if (!harness) throw new Error('Selected harness is not installed');
    if (payload.sessionId !== undefined && (typeof payload.sessionId !== 'string' || !payload.sessionId || payload.sessionId.length > 200)) throw new Error('Invalid saved session id');
    const runtime = harness.create({ spawn: this.spawn, settings, binding, cwd: payload.cwd, options: this.options });
    this.sessions.set(runtime.id, runtime);
    try { return await runtime.start(payload.sessionId); }
    catch (error) { this.sessions.delete(runtime.id); await runtime.close(); throw error; }
  }
  session(id) {
    const runtime = this.sessions.get(id);
    if (!runtime) throw new Error('Session not found; reconnect using its Kimi session id');
    return runtime;
  }
  async dispatch(endpoint, payload = {}, signal) {
    if (this.stopped) throw new Error('Plugin is stopping');
    if (!payload || typeof payload !== 'object') throw new Error('Invalid request');
    switch (endpoint) {
      case 'settings/read': return this.settings();
      case 'settings/save': return this.store.save(payload);
      case 'models/read': return readModels(absolutePath(payload.kimiHome, 'Kimi home'));
      case 'sessions/list': return [...this.sessions.values()].map(s => ({ id: s.id, sessionId: s.sessionId, status: s.status, cwd: s.cwd, binding: s.binding }));
      case 'sessions/start': return this.start(payload);
      case 'sessions/read': return this.session(payload.id).wait(payload.revision, signal);
      case 'sessions/prompt': return this.session(payload.id).prompt(payload.text);
      case 'sessions/cancel': return this.session(payload.id).cancel();
      case 'sessions/permission': this.session(payload.id).permission(payload.requestId, payload.optionId); return { accepted: true };
      case 'sessions/close': {
        const runtime = this.session(payload.id); await runtime.close(); this.sessions.delete(payload.id); return { closed: true };
      }
      default: throw new Error('Unknown harness operation');
    }
  }
  async dispose() {
    this.stopped = true;
    const results = await Promise.allSettled([...this.sessions.values()].map(s => s.close()));
    this.sessions.clear();
    const errors = results.filter(r => r.status === 'rejected').map(r => r.reason);
    if (errors.length) throw new AggregateError(errors, 'Harness shutdown failed');
  }
}

export function resolveOptions(config = {}) {
  const options = { maxSessions: 4, maxMessages: 500, maxTextLength: 32000, requestTimeoutMs: 30000, disposeMs: 5000, ...config };
  for (const key of ['maxSessions', 'maxMessages', 'maxTextLength', 'requestTimeoutMs', 'disposeMs']) {
    if (!Number.isSafeInteger(options[key]) || options[key] < 1 || options[key] > 2147483647) throw new Error(`Invalid configuration: ${key}`);
  }
  return options;
}

export function apply(ctx, config = {}) {
  const options = resolveOptions(config);
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  const file = config.settingsFile ? absolutePath(config.settingsFile, 'Settings file') : join(home, 'storages', 'harness-switch', `${process.env.DSH_PROFILE || 'default'}.json`);
  const manager = new HarnessManager(new SettingsStore(file), spec => ctx.subprocess.spawn(spec), options);
  ctx.effect(() => () => manager.dispose());
  ctx.effect(() => ctx.provide('harnessSwitch', manager));
  ctx.effect(() => ctx.connection.rpc.handle('/harness-switch', async (endpoint, payload, signal) => {
    try { return { ok: true, value: await manager.dispatch(endpoint, payload, signal) }; }
    catch (error) {
      // Do not forward raw ACP/HTTP error bodies, which can include authorization headers.
      const message = endpoint.startsWith('sessions/') ? 'Kimi operation failed. Check the executable, model alias, configuration and session state.' : 'Settings operation failed. Check the path, model bindings and TOML syntax.';
      return { ok: false, error: { code: 'harness-switch/operation-failed', message, details: {} } };
    }
  }));
}
