// Explicit opt-in: uses the installed DSH runtime and your configured Kimi account.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import * as plugin from '../index.js';
import { PROVIDER } from '../src/native.js';
const root = process.env.DSH_MODULES;
if (!root) throw new Error('Set DSH_MODULES to installed DSH node_modules');
const load = (name, file = 'index.js') => import(pathToFileURL(join(root, '@deepseek-ai', name, 'lib', file)).href);
const { Context } = await load('cordis');
const { installModelSelection } = await load('dsh-agent');
const { createUserMessage, LlmAdapter } = await load('dsh-llm');
const { defineContentToolFixture } = await load('dsh-tools');
const ctx = new Context();
const fibers = [];
try {
  for (const name of ['dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-agent-loop']) {
    fibers.push(await ctx.plugin((await load(name)).default, name === 'dsh-agent-loop' ? { agents: [] } : {}));
  }
  ctx.provide('connection', { rpc: { handle() { return () => {}; } } });
  await mkdir('tests/.smoke-workspace', { recursive: true });
  const kimiRequests = [];
  const registerAdapter = ctx.llm.registerAdapter.bind(ctx.llm);
  ctx.llm.registerAdapter = (providers, adapter) => {
    if (providers.includes(PROVIDER)) {
      const prepare = adapter.prepareCall.bind(adapter);
      adapter.prepareCall = async (...args) => { const call = await prepare(...args); return { ...call, stream: options => { kimiRequests.push(options); return call.stream(options); } }; };
    }
    return registerAdapter(providers, adapter);
  };
  fibers.push(await ctx.plugin(plugin, { settingsFile: resolve('tests/.smoke-workspace/native-settings.json') }));
  let toolCalls = 0;
  ctx.tools.register(defineContentToolFixture({ name: 'harness_probe', description: 'Return the verification token for this test.', parameters: {}, execute: async () => {
    toolCalls++; return [{ type: 'text', text: 'NATIVE_TOOL_OK' }];
  } }));
  const observed = [];
  // Inspect final routed requests without logging their potentially private history.
  const native = ctx.llm;
  const original = native.registerAdapter.bind(native);
  class NativeProbe extends LlmAdapter {
    async *stream(options) {
      observed.push(options);
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: 'DSH_RESTORED' };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'DSH_RESTORED' } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  original(['native-probe'], new NativeProbe());
  const agent = await ctx.agentLoop.create(`harness-smoke-${randomUUID()}`, { provider: PROVIDER, model: 'kimi-k3', maxSteps: 4 });
  const selection = { current: { provider: PROVIDER, model: 'kimi-k3', reasoningEffort: 'low' } };
  installModelSelection(agent.ctx, selection);
  async function turn(text) {
    const idle = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { dispose(); reject(new Error('Native turn timed out')); }, 90000);
      const dispose = ctx.on('agent/status', ({ agent: subject, status }) => { if (subject === agent && status === 'idle') { clearTimeout(timeout); dispose(); resolve(); } });
    });
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }));
    await idle;
  }
  await turn('Call harness_probe exactly once and reply with the verification token it returns.');
  assert.equal(toolCalls, 1, 'Kimi should execute the native DSH tool');
  assert.match(kimiRequests[0].system, /DSH compatibility runtime/);
  selection.current = { provider: 'native-probe', model: 'native' };
  await turn('Continue in the same session.');
  assert.equal(observed.length, 1);
  assert.doesNotMatch(observed[0].system || '', /DSH compatibility runtime/);
  assert.match(JSON.stringify(observed[0].messages), /NATIVE_TOOL_OK/);
  selection.current = { provider: PROVIDER, model: 'kimi-k3', reasoningEffort: 'low' };
  await turn('Do not use tools. Repeat the verification token from earlier.');
  assert.match(kimiRequests.at(-1).system, /DSH compatibility runtime/);
  console.log(JSON.stringify({ nativeToolCalls: toolCalls, sameSession: agent.session.id, switchToNativeRestoredPrompt: true, historyPreserved: true, switchBackCompleted: true }));
} finally { for (const fiber of fibers.reverse()) await fiber.dispose(); }


