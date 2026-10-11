import { Readable, Writable } from 'node:stream';
import { stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'smol-toml';
import { client, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { absolutePath } from './settings.js';

export async function modelEnvironment(settings, model) {
  const document = parse(await readFile(join(settings.kimiHome, 'config.toml'), 'utf8'));
  const entry = document.models?.[model];
  if (!entry) throw new Error(`Model alias is not configured in Kimi: ${model}`);
  const provider = document.providers?.[entry.provider];
  if (!provider) throw new Error('Kimi model provider is missing');
  const env = { KIMI_CODE_HOME: settings.kimiHome };
  if (typeof provider.api_key_env === 'string') {
    const key = process.env[provider.api_key_env];
    if (!key) throw new Error(`Credential environment variable is unset: ${provider.api_key_env}`);
    env[provider.api_key_env] = key;
  }
  return env;
}

/** One persistent ACP session. Kimi owns prompts, tools, history, and compaction. */
export class KimiSession {
  constructor({ spawn, settings, binding, cwd, options }) {
    Object.assign(this, { spawn, settings, binding, cwd, options });
    this.id = randomUUID();
    this.revision = 0;
    this.messages = [];
    this.permissions = new Map();
    this.status = 'starting';
    this.closed = false;
    this.waiters = new Set();
    this.textBytes = 0;
    this.trimmed = false;
  }
  changed() {
    this.revision++;
    for (const done of this.waiters) done();
    this.waiters.clear();
  }
  append(role, text, extra = {}) {
    if (typeof text !== 'string') return;
    this.messages.push({ id: randomUUID(), role, text, ...extra });
    this.limit();
    this.changed();
  }
  limit() {
    // This is a display window only. The authoritative transcript remains in Kimi.
    while (this.messages.length > this.options.maxMessages) { this.messages.shift(); this.trimmed = true; }
    for (const message of this.messages) if (message.text.length > this.options.maxTextLength) {
      message.text = message.text.slice(-this.options.maxTextLength); this.trimmed = true;
    }
  }
  update({ update }) {
    const kind = update.sessionUpdate;
    if (kind === 'agent_message_chunk' || kind === 'agent_thought_chunk' || kind === 'user_message_chunk') {
      const role = kind === 'agent_message_chunk' ? 'assistant' : kind === 'agent_thought_chunk' ? 'thinking' : 'user';
      const text = update.content?.type === 'text' ? update.content.text : `[${update.content?.type || 'content'}]`;
      const last = this.messages.at(-1);
      if (last?.role === role && last.streaming) { last.text += text; this.limit(); this.changed(); }
      else this.append(role, text, { streaming: true });
    } else if (kind === 'tool_call' || kind === 'tool_call_update') {
      let tool = this.messages.find(m => m.toolCallId === update.toolCallId);
      if (!tool) {
        this.append('tool', '', { toolCallId: update.toolCallId });
        tool = this.messages.at(-1);
      }
      for (const key of ['title', 'status', 'kind', 'locations']) if (update[key] !== undefined) tool[key] = update[key];
      if (update.content) tool.text = update.content.map(c => c.type === 'content' && c.content?.type === 'text' ? c.content.text : JSON.stringify(c)).join('\n');
      this.limit(); this.changed();
    } else if (kind === 'config_option_update') {
      this.configOptions = update.configOptions; this.changed();
    } else if (kind === 'plan') {
      this.plan = update.entries; this.changed();
    }
  }
  async start(resumeId) {
    this.cwd = absolutePath(this.cwd, 'Working directory');
    if (!(await stat(this.cwd)).isDirectory()) throw new Error('Working directory is not a directory');
    const env = await modelEnvironment(this.settings, this.binding.model);
    if (this.closed) throw new Error('Session closed during startup');
    this.child = this.spawn({ argv: [this.settings.command, '-m', this.binding.model, 'acp'], cwd: this.cwd,
      env, stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 16384 } }, graceMs: this.options.disposeMs });
    this.child.done.then(() => this.processEnded(), () => this.processEnded());
    const app = client({ name: 'dsh-harness-switch', version: '0.1.0' })
      .onNotification(methods.client.session.update, ({ params }) => { this.update(params); return Promise.resolve(); })
      .onRequest(methods.client.session.requestPermission, ({ params }) => {
        if (this.closed) return Promise.resolve({ outcome: { outcome: 'cancelled' } });
        const id = randomUUID();
        return new Promise(resolve => {
          this.permissions.set(id, { id, ...params, resolve }); this.changed();
        });
      });
    this.connection = app.connect(ndJsonStream(Writable.toWeb(this.child.stdin), Readable.toWeb(this.child.stdout)));
    this.agent = this.connection.agent;
    try {
      const info = await this.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
      this.runtime = info.agentInfo;
      this.capabilities = info.agentCapabilities;
      const parameters = { cwd: this.cwd, mcpServers: [] };
      if (resumeId) {
        if (!info.agentCapabilities?.loadSession) throw new Error('This runtime cannot resume sessions');
        const loaded = await this.request(methods.agent.session.load, { ...parameters, sessionId: resumeId });
        this.sessionId = resumeId;
        this.configOptions = loaded.configOptions;
      } else {
        const created = await this.request(methods.agent.session.new, parameters);
        this.sessionId = created.sessionId;
        this.configOptions = created.configOptions;
      }
      if (this.closed) throw new Error('Session closed during startup');
      this.status = 'idle'; this.changed();
      return this.snapshot();
    } catch (error) { await this.close(); throw error; }
  }
  async request(method, params) {
    let timer;
    try {
      return await Promise.race([this.agent.request(method, params), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Kimi request timed out: ${method}`)), this.options.requestTimeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }
  processEnded() {
    if (!this.closed) { this.status = 'error'; this.error = 'Kimi process exited; reconnect to resume the saved session'; }
    this.cancelPermissions(); this.changed();
  }
  prompt(text) {
    if (this.closed || this.status !== 'idle') throw new Error('Session is not idle');
    if (typeof text !== 'string' || !text.trim() || text.length > 200000) throw new Error('Prompt must contain 1–200000 characters');
    this.status = 'running'; this.error = undefined;
    for (const m of this.messages) m.streaming = false;
    this.append('user', text);
    this.active = this.agent.request(methods.agent.session.prompt, { sessionId: this.sessionId, prompt: [{ type: 'text', text }] })
      .then(result => { this.stopReason = result.stopReason; if (!this.closed && this.status !== 'error') this.status = 'idle'; })
      .catch(() => { if (!this.closed) { this.status = 'error'; this.error = 'Kimi request failed. Check authentication and runtime diagnostics, then reconnect.'; } })
      .finally(() => { this.cancelPermissions(); this.changed(); });
    return this.snapshot();
  }
  permission(id, optionId) {
    const permission = this.permissions.get(id);
    if (!permission) throw new Error('Permission request is no longer pending');
    if (optionId !== null && !permission.options.some(o => o.optionId === optionId)) throw new Error('Invalid permission option');
    this.permissions.delete(id);
    permission.resolve({ outcome: optionId === null ? { outcome: 'cancelled' } : { outcome: 'selected', optionId } });
    this.changed();
  }
  cancelPermissions() {
    for (const permission of this.permissions.values()) permission.resolve({ outcome: { outcome: 'cancelled' } });
    this.permissions.clear();
  }
  async cancel() {
    this.cancelPermissions();
    if (this.status === 'running') {
      this.status = 'cancelling'; this.changed();
      await this.agent.notify(methods.agent.session.cancel, { sessionId: this.sessionId });
      let timer;
      try {
        await Promise.race([this.active, new Promise(resolve => { timer = setTimeout(resolve, this.options.disposeMs); })]);
      } finally { clearTimeout(timer); }
      if (this.status === 'cancelling') await this.close();
    }
    return this.snapshot();
  }
  snapshot() {
    return { id: this.id, sessionId: this.sessionId, revision: this.revision, binding: this.binding, cwd: this.cwd,
      status: this.status, runtime: this.runtime, messages: structuredClone(this.messages), trimmed: this.trimmed,
      permissions: [...this.permissions.values()].map(({ resolve, ...request }) => request),
      configOptions: this.configOptions, plan: this.plan, error: this.error, stopReason: this.stopReason };
  }
  async wait(revision, signal) {
    if (this.revision === revision && !this.closed && !signal?.aborted) await new Promise(resolve => {
      let timer;
      const done = () => { clearTimeout(timer); this.waiters.delete(done); signal?.removeEventListener('abort', done); resolve(); };
      this.waiters.add(done);
      signal?.addEventListener('abort', done, { once: true });
      timer = setTimeout(done, 20000);
    });
    return this.snapshot();
  }
  close() { return this.closing ??= this.dispose(); }
  async dispose() {
    this.closed = true; this.status = 'closed'; this.cancelPermissions(); this.changed();
    this.connection?.close();
    if (this.child) {
      this.child.stdin?.end();
      if (await this.child.waitForExit(AbortSignal.timeout(this.options.disposeMs))) return;
      this.child.terminate();
      const exited = await this.child.waitForExit(AbortSignal.timeout(this.options.disposeMs * 2));
      if (!exited) throw new Error('Kimi subprocess did not exit within the shutdown deadline');
    }
  }
}
