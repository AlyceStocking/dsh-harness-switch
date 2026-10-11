import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { SettingsStore, defaults, readModels, validateSettings } from '../src/settings.js';
import { KimiSession } from '../src/kimi.js';
import { HarnessManager, resolveOptions } from '../src/acp-prototype.js';

const tempRoot = fileURLToPath(new URL('./', import.meta.url));
const fixture = fileURLToPath(new URL('./mock-agent.js', import.meta.url));
export function testSpawn(spec) {
  const child = spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, env: { ...process.env, ...spec.env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.on('data', () => {});
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (exitCode, signal) => resolve({ exitCode, signal })); });
  return { stdin: child.stdin, stdout: child.stdout, done, terminate: () => child.kill(),
    waitForExit: async signal => {
      if (child.exitCode !== null || child.signalCode) return true;
      let abort;
      try { return await Promise.race([done.then(() => true, () => true), new Promise(resolve => { abort = () => resolve(false); if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true }); })]); }
      finally { signal?.removeEventListener('abort', abort); }
    } };
}
async function setup(t, extra = {}) {
  const home = await mkdtemp(join(tempRoot, '.tmp-'));
  await writeFile(join(home, 'config.toml'), 'default_model = "kimi-code/k3"\n[providers.test]\ntype="kimi"\napi_key="secret-fixture"\n[models."kimi-code/k3"]\nprovider="test"\nmodel="k3"\n');
  const settings = { ...defaults(), kimiHome: home };
  const calls = [];
  const session = new KimiSession({ settings, binding: settings.bindings[0], cwd: home,
    options: resolveOptions({ disposeMs: 1000, requestTimeoutMs: 3000 }),
    spawn: spec => { calls.push(spec); return testSpawn({ ...spec, argv: [process.execPath, fixture], env: { ...spec.env, ...extra } }); },
  });
  t.after(() => session.close());
  return { session, calls, home, settings };
}
async function until(fn) {
  const stop = Date.now() + 4000;
  while (!fn()) { if (Date.now() > stop) throw new Error('Test condition timed out'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
test('forwards only raw user prompts, reuses one session, and preserves tool events', async t => {
  const { session, calls } = await setup(t);
  await session.start();
  assert.deepEqual(calls[0].argv, ['kimi', '-m', 'kimi-code/k3', 'acp']);
  session.prompt('hello'); await session.active;
  session.prompt('again'); await session.active;
  assert.equal(calls.length, 1);
  assert.equal(session.messages.at(-1).text, 'turn 2: again');
  assert.equal(session.messages.filter(m => m.role === 'tool').length, 2);
  assert.equal(session.messages.find(m => m.role === 'tool').status, 'completed');
  assert.equal(session.runtime.version, 'test');
});
test('approval waits for the user and rejects invented option IDs', async t => {
  const { session } = await setup(t); await session.start(); session.prompt('permission');
  await until(() => session.permissions.size > 0);
  const [id] = session.permissions.keys();
  assert.equal(session.status, 'running');
  assert.throws(() => session.permission(id, 'made-up'), /Invalid/);
  session.permission(id, 'allow'); await session.active;
  assert.match(session.messages.at(-1).text, /selected/);
  assert.equal(session.permissions.size, 0);
});
test('cancellation settles a running request and the session accepts another turn', async t => {
  const { session } = await setup(t); await session.start(); session.prompt('hang');
  await session.cancel();
  assert.equal(session.status, 'idle'); assert.equal(session.stopReason, 'cancelled');
  session.prompt('next'); await session.active; assert.match(session.messages.at(-1).text, /next/);
});
test('restore replays Kimi history without injecting parent history', async t => {
  const { session } = await setup(t); await session.start('saved-id');
  assert.equal(session.sessionId, 'saved-id'); assert.equal(session.messages[0].text, 'restored');
});
test('crash during initialization fails and tears down', async t => {
  const { session } = await setup(t, { MOCK_CRASH: '1' });
  await assert.rejects(session.start()); assert.equal(session.closed, true);
});
test('settings reject duplicate bindings and unknown harnesses; model listing strips secrets', async t => {
  const { home, settings } = await setup(t);
  assert.throws(() => validateSettings({ ...settings, bindings: [...settings.bindings, ...settings.bindings] }), /duplicate/);
  assert.throws(() => validateSettings({ ...settings, bindings: [{ ...settings.bindings[0], harness: 'zcode' }] }), /Unknown/);
  assert.doesNotMatch(JSON.stringify(await readModels(home)), /secret-fixture/);
  const store = new SettingsStore(join(home, 'settings.json'));
  await store.save(settings); assert.deepEqual(await store.read(), settings);
  assert.doesNotMatch(await readFile(store.file, 'utf8'), /secret-fixture/);
});
test('plugin disposal prevents late startups and new work', async t => {
  const { home, settings } = await setup(t);
  const store = new SettingsStore(join(home, 'manager.json')); await store.save(settings);
  const manager = new HarnessManager(store, spec => testSpawn({ ...spec, argv: [process.execPath, fixture] }), resolveOptions({ disposeMs: 1000 }));
  const opening = manager.start({ bindingId: 'kimi-k3', cwd: home });
  const outcome = opening.catch(error => error);
  await manager.dispose();
  assert.ok(await outcome instanceof Error);
  await assert.rejects(manager.start({ bindingId: 'kimi-k3', cwd: home }), /stopping/);
});
