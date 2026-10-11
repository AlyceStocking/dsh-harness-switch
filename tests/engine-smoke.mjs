import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as plugin from '../index.js';
import { SettingsStore, defaults } from '../src/settings.js';
import { PROVIDER } from '../src/native.js';
const root = process.env.DSH_MODULES;
if (!root) throw new Error('Set DSH_MODULES to the installed DSH node_modules');
const load = name => import(pathToFileURL(join(root, '@deepseek-ai', name, 'lib/index.js')).href);
const { Context } = await load('cordis');
const { installModelSelection } = await load('dsh-agent');
const { createUserMessage, LlmAdapter } = await load('dsh-llm');
const ctx = new Context(), fibers = [];
const cwd = resolve('tests/.smoke-workspace'); await mkdir(cwd, { recursive: true });
execFileSync('git', ['init', '--quiet'], { cwd });
await writeFile(join(cwd, 'smoke-marker.txt'), 'EMBEDDED_ENGINE_OK');
const skillDir = join(cwd, '.kimi-code', 'skills', 'harness-smoke');
await mkdir(skillDir, { recursive: true });
await writeFile(join(skillDir, 'SKILL.md'), '---\nname: harness-smoke\ndescription: Smoke test for the DSH embedded Kimi integration\n---\nReply with exactly SKILL_ENGINE_OK. Do not use tools.\n');
const settingsFile = join(cwd, 'engine-settings.json');
await new SettingsStore(settingsFile).save(defaults());
try {
  for (const name of ['dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-agent-loop', 'dsh-user-approval', 'dsh-user-questions']) {
    fibers.push(await ctx.plugin((await load(name)).default, name === 'dsh-agent-loop' ? { agents: [] } : name === 'dsh-user-approval' ? { policy: 'ask' } : {}));
  }
  ctx.provide('connection', { rpc: { handle() { return () => {}; } } });
  const approvals = [];
  ctx.on('approval/request', async request => {
    approvals.push(request.toolName);
    return ['Kimi · Workspace trust', 'Kimi · Read'].includes(request.toolName) || (request.toolName === 'Kimi · Bash' && request.reason.includes('EMBEDDED_SHELL_OK')) ? 'allowed-once' : 'rejected';
  });
  fibers.push(await ctx.plugin(plugin, { settingsFile }));
  const requests = [];
  class OtherAdapter extends LlmAdapter {
    async *stream(options) {
      requests.push(options);
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: 'FOREIGN_ENGINE_TOKEN' };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'FOREIGN_ENGINE_TOKEN' } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['native-probe'], new OtherAdapter());
  const agent = await ctx.agentLoop.create(`engine-${randomUUID()}`, { provider: PROVIDER, model: 'kimi-k3' }, { cwd });
  const selection = { current: { provider: PROVIDER, model: 'kimi-k3', reasoningEffort: 'low' } };
  installModelSelection(agent.ctx, selection);
  async function turn(text) {
    const idle = new Promise((resolveIdle, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error('Turn timed out')); }, 90000);
      const off = ctx.on('agent/status', ({ agent: a, status }) => { if (a === agent && status === 'idle') { clearTimeout(timer); off(); resolveIdle(); } });
    });
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }));
    await idle;
    const last = agent.session.deriveMessages().filter(m => m.role === 'assistant').at(-1);
    return last?.content.filter(b => b.type === 'text').map(b => b.text).join('') || '';
  }
  const reply = await turn('Use the Read tool to read smoke-marker.txt and reply with just its content. This file contains only a public test marker, not a credential.');
  assert.equal(reply, 'EMBEDDED_ENGINE_OK');
  const toolResult = agent.session.snapshotEvents().find(e => e.type === 'tool/result');
  assert.ok(toolResult);
  const view = await ctx.kimiEngine.view(toolResult.data.meta.callId);
  assert.ok(view.events.some(e => e.type === 'tool.call.started' && e.name === 'Read'));
  selection.current = { provider: 'native-probe', model: 'native' };
  assert.equal(await turn('Return your token.'), 'FOREIGN_ENGINE_TOKEN');
  assert.ok((requests[0].tools || []).every(t => t.name !== 'kimi_harness_turn'));
  assert.match(JSON.stringify(requests[0].messages), /EMBEDDED_ENGINE_OK/);
  selection.current = { provider: PROVIDER, model: 'kimi-k3', reasoningEffort: 'low' };
  assert.match(await turn('Do not use tools. What token did the other model just return?'), /FOREIGN_ENGINE_TOKEN/);
  assert.match(await turn('Use Bash to execute exactly: printf EMBEDDED_SHELL_OK . Reply with the command output.'), /EMBEDDED_SHELL_OK/);
  const shellResult = agent.session.snapshotEvents().filter(e => e.type === 'tool/result').at(-1);
  const shellView = await ctx.kimiEngine.view(shellResult.data.meta.callId);
  assert.ok(shellView.events.some(e => e.type === 'tool.call.started' && e.name === 'Bash'));
  assert.ok(shellView.events.some(e => e.type === 'tool.result' && !e.isError && JSON.stringify(e.output).includes('EMBEDDED_SHELL_OK')));
  assert.match(await turn('/kimi-skill harness-smoke'), /SKILL_ENGINE_OK/);
  const skillResult = agent.session.snapshotEvents().filter(e => e.type === 'tool/result').at(-1);
  const skillView = await ctx.kimiEngine.view(skillResult.data.meta.callId);
  assert.ok(skillView.events.some(e => e.type === 'skill.activated' && e.skillName === 'harness-smoke'));
  assert.equal(await turn('/kimi-compact Preserve token facts from the conversation.'), 'Kimi context compacted.');
  console.log(JSON.stringify({ sessionId: agent.session.id, embeddedRead: true, approvedBash: true, switchRestoredTools: true, importedForeignHistory: true, projectSkillActivated: true, compacted: true, approvals }));
} finally { for (const fiber of fibers.reverse()) await fiber.dispose(); }
