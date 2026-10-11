import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { EngineManager, EngineAdapter, ENGINE_TOOL, conversationForImport } from '../src/engine.js';
import { PROVIDER } from '../src/native.js';
import { defaults } from '../src/settings.js';

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(resolve('tests/.tmp-engine-'));
  const messages = [{ id: 'user-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }];
  const listeners = new Set();
  const calls = [];
  const emit = e => { for (const fn of listeners) fn({ agentId: 'main', ...e }); };
  const session = {
    id: 'kimi-1',
    async setModel() {}, async setThinking() {}, async setPermission(value) { assert.equal(value, 'manual'); },
    setApprovalHandler(handler) { this.approval = handler; }, setQuestionHandler(handler) { this.question = handler; },
    onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async importContext(text) { calls.push(['import', text]); },
    async prompt(text) { calls.push(['prompt', text]); emit({ type: 'assistant.delta', delta: 'done' }); emit({ type: 'turn.ended', reason: 'completed' }); },
    async promptWithSkills(text, skills) { calls.push(['skills', skills]); return this.prompt(text); },
    async compact() { calls.push(['compact']); emit({ type: 'compaction.completed' }); },
    async cancel() { calls.push(['cancel']); }, async cancelCompaction() {},
    ...overrides.session,
  };
  const host = {
    async createSession() { calls.push(['create']); return session; }, async resumeSession() { calls.push(['resume']); return session; },
    async getWorkspaceTrustInfo() { return { trusted: true }; }, async trustWorkspace() { calls.push(['trust']); },
    async close() {}, ...overrides.host,
  };
  const ctx = { approval: { async request() { return 'rejected'; } }, ...overrides.ctx };
  const settings = defaults();
  const store = { async read() { return settings; } };
  const createManager = () => new EngineManager(ctx, store, directory, { factory: async () => () => host });
  const manager = createManager();
  const controller = new AbortController();
  const exec = { callId: 'call-1', signal: controller.signal, agent: { session: {
    id: 'dsh-1', header: { cwd: resolve('tests') }, requestHeader: () => ({ config: { provider: PROVIDER, model: settings.bindings[0].id } }), deriveMessages: () => messages,
  } } };
  t.after(async () => { await manager.dispose(); await rm(directory, { recursive: true, force: true }); });
  return { manager, session, calls, exec, controller, messages, emit, createManager, listeners };
}

test('embedded turns persist, deduplicate retry, and resume Kimi state across manager restart', async t => {
  const f = await fixture(t);
  const first = await f.manager.run({ messageId: 'user-1' }, f.exec);
  assert.equal(first.text, 'done');
  assert.equal((await f.manager.view('call-1')).status, 'completed');
  assert.deepEqual(await f.manager.run({ messageId: 'user-1' }, { ...f.exec, callId: 'retry' }), first);
  assert.equal(f.calls.filter(c => c[0] === 'prompt').length, 1);
  await f.manager.dispose();
  const next = f.createManager();
  try {
    f.messages.push({ ...f.messages[0], id: 'user-2' });
    await next.run({ messageId: 'user-2' }, { ...f.exec, callId: 'call-2' });
    assert.equal(f.calls.filter(c => c[0] === 'resume').length, 1);
    assert.equal((await next.view('call-1')).status, 'completed');
  } finally { await next.dispose(); }
});

test('permission bridge fails closed and rejected trust never starts a model turn', async t => {
  const f = await fixture(t, { host: { async getWorkspaceTrustInfo() { return { trusted: false }; } } });
  assert.deepEqual(await f.manager.approve(f.exec, { toolName: 'Bash', action: 'execute' }), { decision: 'rejected' });
  await assert.rejects(f.manager.run({ messageId: 'user-1' }, f.exec), /trust was declined/);
  assert.equal(f.calls.some(c => ['prompt', 'trust'].includes(c[0])), false);
  assert.equal(f.session.approval, undefined);
});

test('cancellation before turn.started settles even when Kimi emits no turn.ended; interrupted prompt is not repeated', { timeout: 5000 }, async t => {
  const enqueued = Promise.withResolvers();
  const f = await fixture(t, { session: { async prompt() { enqueued.resolve(); } } });
  const pending = f.manager.run({ messageId: 'user-1' }, f.exec);
  await enqueued.promise;
  f.controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(f.listeners.size, 0);
  assert.equal((await f.manager.view('call-1')).status, 'cancelled');
  await assert.rejects(f.manager.run({ messageId: 'user-1' }, { ...f.exec, signal: new AbortController().signal }), /not be run twice/);
});

test('plugin disposal cancels an enqueued turn without waiting for a model event', { timeout: 5000 }, async t => {
  const enqueued = Promise.withResolvers();
  const f = await fixture(t, { session: { async prompt() { enqueued.resolve(); } } });
  const pending = f.manager.run({ messageId: 'user-1' }, f.exec);
  const rejected = assert.rejects(pending, /cancelled/);
  await enqueued.promise;
  await f.manager.dispose(); await rejected;
});

test('explicit skill activation and manual compaction use upstream session APIs', async t => {
  const f = await fixture(t);
  f.messages[0].content[0].text = '/kimi-skill example do something';
  await f.manager.run({ messageId: 'user-1' }, f.exec);
  assert.deepEqual(f.calls.find(c => c[0] === 'skills')[1], [{ name: 'example', args: 'do something' }]);
  f.messages.push({ ...f.messages[0], id: 'compact-1', content: [{ type: 'text', text: '/kimi-compact keep important facts' }] });
  const result = await f.manager.run({ messageId: 'compact-1' }, { ...f.exec, callId: 'compact-call' });
  assert.match(result.text, /compacted/);
  assert.equal(f.calls.filter(c => c[0] === 'compact').length, 1);
  assert.match(result.transcript, /compaction.completed/);
});

test('unexpected SDK errors do not leak credentials to DSH', async t => {
  const f = await fixture(t, { session: { async prompt() { throw new Error('Authorization: secret-api-key'); } } });
  await assert.rejects(f.manager.run({ messageId: 'user-1' }, f.exec), e => !e.message.includes('secret') && /runtime failed/.test(e.message));
});

test('history import pairs foreign calls/results, excludes engine transport and foreign reasoning', () => {
  const history = [
    { id: 'foreign', role: 'assistant', source: { provider: 'deepseek' }, content: [{ type: 'tool-call', id: 'x', name: 'Read', arguments: '{}' }, { type: 'reasoning', text: 'private' }] },
    { id: 'result', role: 'user', content: [{ type: 'tool-result', toolCallId: 'x', content: [{ type: 'text', text: 'value' }] }] },
    { id: 'own', role: 'assistant', source: { provider: PROVIDER }, content: [{ type: 'tool-call', id: 'k', name: ENGINE_TOOL }] },
    { id: 'own-result', role: 'user', content: [{ type: 'tool-result', toolCallId: 'k' }] },
  ];
  const imported = conversationForImport(history, [], 'current');
  assert.equal(imported.length, 2); assert.match(JSON.stringify(imported), /value/);
  assert.doesNotMatch(JSON.stringify(imported), /private|kimi_harness_turn/);
  assert.equal(conversationForImport(history, ['foreign', 'result'], 'current').length, 0);
  history.push({ id: 'new-user', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'try DSH tools' }] });
  history.push({ id: 'same-provider', role: 'assistant', source: { provider: PROVIDER, model: 'kimi-dsh' }, content: [{ type: 'text', text: 'DSH_HARNESS_ANSWER' }] });
  assert.match(JSON.stringify(conversationForImport(history, [], 'current')), /DSH_HARNESS_ANSWER/);
});

test('adapter schedules one transport call and replays its final answer without another API request', async () => {
  const adapter = new EngineAdapter({});
  const messages = [{ id: 'u', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }];
  const chunks = await Array.fromAsync(adapter.generate({ messages }, { harness: 'kimi-engine' }));
  const call = chunks.find(c => c.type === 'block-end').block;
  assert.equal(call.name, ENGINE_TOOL); assert.deepEqual(JSON.parse(call.arguments), { messageId: 'u' });
  messages.push({ role: 'assistant', source: { provider: PROVIDER }, content: [call] });
  messages.push({ role: 'user', content: [{ type: 'tool-result', toolCallId: call.id, content: [{ type: 'text', text: JSON.stringify({ text: 'upstream answer' }) }] }] });
  const reply = await Array.fromAsync(adapter.generate({ messages }, { harness: 'kimi-engine' }));
  assert.equal(reply.find(c => c.type === 'text-delta').text, 'upstream answer');
});
