import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { SettingsStore, readModels, absolutePath } from './src/settings.js';
import { PROVIDER, HARNESSES, applyHarness } from './src/native.js';
import { EngineManager, EngineAdapter, ENGINE_HARNESS } from './src/engine.js';

export const name = 'harness-switch';
export const inject = ['webServer', 'connection', 'llm', 'systemPrompt', 'agents', 'tools', 'approval', 'userQuestions', 'attachments'];

export function apply(ctx, config = {}) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  const file = config.settingsFile ? absolutePath(config.settingsFile, 'Settings file') : join(home, 'storages', 'harness-switch', `${process.env.DSH_PROFILE || 'default'}.json`);
  const store = new SettingsStore(file);
  const adapter = new EngineAdapter(store);
  const manager = new EngineManager(ctx, store, join(dirname(file), 'engine'));
  const scopes = new Map();
  ctx.effect(() => () => { for (const release of scopes.values()) release(); scopes.clear(); });
  ctx.effect(() => () => manager.dispose());
  ctx.effect(() => ctx.provide('kimiEngine', manager));
  let registration;
  ctx.effect(() => { registration = ctx.llm.registerAdapter([PROVIDER], adapter); return registration; });
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next();
    const binding = assembled.variables.provider === PROVIDER ? (await store.read()).bindings.find(b => b.id === assembled.variables.model) : undefined;
    const agent = context.agent;
    if (agent && scopes.has(agent) && binding?.harness !== ENGINE_HARNESS) {
      scopes.get(agent)(); scopes.delete(agent);
      return ctx.systemPrompt.assemble(context);
    }
    if (assembled.variables.provider !== PROVIDER) return assembled;
    if (!binding) throw new Error('Selected harness model binding no longer exists');
    if (binding.harness === ENGINE_HARNESS) {
      if (agent && !scopes.has(agent)) {
        const releaseMode = agent.ctx.tools.presentAs('native');
        let releaseTool;
        try { releaseTool = agent.ctx.tools.register(manager.definition()); } catch (e) { releaseMode(); throw e; }
        let released = false;
        const release = () => { if (released) return; released = true; releaseTool(); releaseMode(); };
        scopes.set(agent, release);
        agent.ctx.effect(() => () => { release(); if (scopes.get(agent) === release) scopes.delete(agent); });
      }
      const { name, description, parameters } = manager.definition();
      return { ...assembled, sections: [{ name: 'harness-switch:transport', text: 'Kimi Code embedded runtime owns the model prompt, tool execution, permissions, Skills and compaction. This DSH request is a local transport envelope.' }], contexts: [], tools: [{ name, description, parameters }] };
    }
    return applyHarness(assembled, binding);
  });
  ctx.effect(() => ctx.connection.register(ctx, '/harness-switch', async (endpoint, payload) => {
    try {
      let value;
      if (endpoint === 'settings/read') value = { settings: await store.read(), harnesses: HARNESSES };
      else if (endpoint === 'engine/view') value = await manager.view(payload.callId);
      else if (endpoint === 'models/read') value = await readModels(absolutePath(payload.kimiHome, 'Kimi home'));
      else if (endpoint === 'settings/save') {
        if (ctx.agents.list().some(agent => agent.status !== 'idle' && agent.status !== 'disposed')) {
          return { ok: false, error: { code: 'harness-switch/busy', message: 'Stop active DSH turns before changing harness configuration.', details: {} } };
        }
        value = await store.save(payload);
        registration.replace([PROVIDER]);
      } else throw new Error('Unknown operation');
      return { ok: true, value };
    }
    catch (error) {
      // Do not forward raw ACP/HTTP error bodies, which can include authorization headers.
      const message = 'Settings operation failed. Check the path, model bindings and TOML syntax.';
      return { ok: false, error: { code: 'harness-switch/operation-failed', message, details: {} } };
    }
  }));
}
