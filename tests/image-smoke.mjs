// Opt-in real API test; uploads only a generated color fixture.
import assert from 'node:assert/strict';
import { Jimp } from 'jimp';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as plugin from '../index.js';
import { EngineAdapter } from '../src/engine.js';
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
  fibers.push(await ctx.plugin((await load('dsh-attachment-local')).default, { dshHome: join(cwd, 'image-home') }));
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
    agent.followup(createUserMessage({ content: Array.isArray(text) ? text : [{ type: 'text', text }], source: { kind: 'user' } }));
    await idle;
    const last = agent.session.deriveMessages().filter(m => m.role === 'assistant').at(-1);
    return last?.content.filter(b => b.type === 'text').map(b => b.text).join('') || '';
  }

  const img = new Jimp({ width: 320, height: 160, color: 0xff0000ff });
  for (let y=0;y<160;y++) for(let x=160;x<320;x++) img.setPixelColor(0x0000ffff,x,y);
  const attachment = await ctx.attachments.saveImage({ data: await img.getBuffer('image/png'), mediaType: 'image/png', name: 'fixture.png' });
  const models = await new EngineAdapter(new SettingsStore(settingsFile)).resolveModel(PROVIDER, 'kimi-k3');
  assert.ok(models.inputModalities.includes('image'));
  const reply = await turn([{ type: 'text', text: 'Do not use tools. Name the color on the LEFT and the color on the RIGHT of this attached image, in English.' }, { type: 'image', attachment }]);
  assert.match(reply, /red/i); assert.match(reply, /blue/i);
  const again = await turn('Without using tools, recall the two colors and their positions in the image I just sent.');
  assert.match(again, /red/i); assert.match(again, /blue/i);
  assert.ok(agent.session.deriveMessages().some(m => m.content.some(b => b.type === 'image')));
  const second = new Jimp({ width: 320, height: 160, color: 0x00ff00ff });
  for (let y=0;y<160;y++) for(let x=160;x<320;x++) second.setPixelColor(0xffff00ff,x,y);
  const foreignImage = await ctx.attachments.saveImage({ data: await second.getBuffer('image/png'), mediaType: 'image/png', name: 'second.png' });
  selection.current = { provider: 'native-probe', model: 'native' };
  await turn([{ type: 'text', text: 'Here is a new image.' }, { type: 'image', attachment: foreignImage }]);
  selection.current = { provider: PROVIDER, model: 'kimi-k3', reasoningEffort: 'low' };
  const imported = await turn('Do not use tools. In the most recent image attached to the prior conversation, what are the LEFT and RIGHT colors? Answer in English.');
  assert.match(imported, /green/i); assert.match(imported, /yellow/i);
  console.log(JSON.stringify({ imageRecognized: true, retainedForFollowup: true, durableDshAttachment: true, foreignImageImported: true, reply, imported }));
} finally { for (const fiber of fibers.reverse()) await fiber.dispose(); }
