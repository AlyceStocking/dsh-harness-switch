import { join } from 'node:path';
import { homedir } from 'node:os';
import { SettingsStore, readModels, absolutePath } from './src/settings.js';
import { NativeAdapter, PROVIDER, HARNESSES, applyHarness } from './src/native.js';

export const name = 'harness-switch';
export const inject = ['connection', 'llm', 'systemPrompt', 'agents'];

export function apply(ctx, config = {}) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  const file = config.settingsFile ? absolutePath(config.settingsFile, 'Settings file') : join(home, 'storages', 'harness-switch', `${process.env.DSH_PROFILE || 'default'}.json`);
  const store = new SettingsStore(file);
  const adapter = new NativeAdapter(store);
  let registration;
  ctx.effect(() => { registration = ctx.llm.registerAdapter([PROVIDER], adapter); return registration; });
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembled = await next();
    if (assembled.variables.provider !== PROVIDER) return assembled;
    const binding = (await store.read()).bindings.find(b => b.id === assembled.variables.model);
    if (!binding) throw new Error('Selected harness model binding no longer exists');
    return applyHarness(assembled, binding);
  });
  ctx.effect(() => ctx.connection.rpc.handle('/harness-switch', async (endpoint, payload) => {
    try {
      let value;
      if (endpoint === 'settings/read') value = { settings: await store.read(), harnesses: HARNESSES };
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
