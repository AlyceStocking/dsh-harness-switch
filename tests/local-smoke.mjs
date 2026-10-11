import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { defaults } from '../src/settings.js';
import { KimiSession } from '../src/kimi.js';
import { resolveOptions } from '../index.js';
const root = process.env.DSH_MODULES;
if (!root) throw new Error('Set DSH_MODULES to the installed DSH node_modules directory');
const { Context } = await import(pathToFileURL(join(root, '@deepseek-ai/cordis/lib/index.js')).href);
const { default: LocalSubprocess } = await import(pathToFileURL(join(root, '@deepseek-ai/dsh-subprocess-local/lib/index.js')).href);
const ctx = new Context();
const fiber = await ctx.plugin(LocalSubprocess);
const cwd = resolve('tests/.smoke-workspace'); await mkdir(cwd, { recursive: true });
const settings = defaults();
const session = new KimiSession({ spawn: spec => ctx.subprocess.spawn(spec), settings, binding: settings.bindings[0], cwd,
  options: resolveOptions({ requestTimeoutMs: 60000 }) });
try {
  const state = await session.start();
  console.log(JSON.stringify({ stage: 'connected', runtime: state.runtime, sessionId: state.sessionId, modelOptions: state.configOptions?.filter(o => o.category === 'model').map(o => ({ id: o.id, currentValue: o.currentValue })) }));
  if (process.env.KIMI_SMOKE_PROMPT === '1') {
    session.prompt('Reply with exactly HARNESS_OK. Do not use tools.');
    const timer = setTimeout(() => session.cancel(), 90000);
    try { await session.active; } finally { clearTimeout(timer); }
    console.log(JSON.stringify({ stage: 'prompt', status: session.status, stopReason: session.stopReason, reply: session.messages.filter(m => m.role === 'assistant').map(m => m.text).join('') }));
  }
} finally { await session.close(); await fiber.dispose(); }
