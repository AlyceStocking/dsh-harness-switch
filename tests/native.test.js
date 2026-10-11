import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeAdapter, PROVIDER, applyHarness, historyToKimi, translateStream } from '../src/native.js';
import { defaults } from '../src/settings.js';

test('Kimi prompt replaces identity, preserves DSH policy/context, native harness restores exact assembly', () => {
  const assembly = { sections: [{ name: 'deployment:persona-prefix', text: 'DeepSeek' }, { name: 'permissions', text: 'Ask first' }], contexts: [{ name: 'cwd', text: '/project' }], tools: [], variables: {} };
  const kimi = applyHarness(assembly, { harness: 'kimi-code' });
  assert.match(kimi.sections[0].text, /Kimi/); assert.equal(kimi.sections[1], assembly.sections[1]);
  assert.equal(kimi.contexts, assembly.contexts); assert.equal(applyHarness(assembly, { harness: 'dsh' }), assembly);
  assert.equal(applyHarness(assembly, undefined), assembly);
  assert.equal(assembly.sections[0].text, 'DeepSeek');
});

test('mixed-provider native history preserves calls/results without double JSON encoding', () => {
  const history = historyToKimi([
    { role: 'assistant', source: { provider: 'deepseek' }, content: [{ type: 'reasoning', text: 'foreign thinking' }, { type: 'tool-call', id: 'a', name: 'read', arguments: '{"file_path":"x"}' }] },
    { role: 'user', content: [{ type: 'tool-result', toolCallId: 'a', content: [{ type: 'text', text: 'result' }] }, { type: 'text', text: 'Continue' }] },
    { role: 'assistant', source: { provider: PROVIDER }, content: [{ type: 'reasoning', text: 'kimi thinking' }, { type: 'text', text: 'done' }] },
  ]);
  assert.equal(history[0].toolCalls[0].arguments, '{"file_path":"x"}'); assert.deepEqual(history[0].content, []);
  assert.equal(history[1].role, 'tool'); assert.equal(history[1].toolCallId, 'a'); assert.equal(history[2].role, 'user');
  assert.equal(history[3].content[0].think, 'kimi thinking');
  assert.throws(() => historyToKimi([{ role: 'user', content: [{ type: 'image' }] }]), /Unsupported/);
});

test('interleaved parallel tool streams retain IDs, raw arguments and disjoint usage', async () => {
  const response = { finishReason: 'tool_calls', usage: { inputOther: 7, output: 4, inputCacheRead: 3 }, async *[Symbol.asyncIterator]() {
    yield { type: 'think', think: 'plan' };
    yield { type: 'function', id: 'a', name: 'read', arguments: '{"file_', _streamIndex: 0 };
    yield { type: 'function', id: 'b', name: 'glob', arguments: '{"pattern":', _streamIndex: 1 };
    yield { type: 'tool_call_part', index: 0, argumentsPart: 'path":"x"}' };
    yield { type: 'tool_call_part', index: 1, argumentsPart: '"*"}' };
  } };
  const chunks = await Array.fromAsync(translateStream(response));
  const tools = chunks.filter(c => c.type === 'block-end' && c.block.type === 'tool-call');
  assert.deepEqual(tools.map(c => JSON.parse(c.block.arguments)), [{ file_path: 'x' }, { pattern: '*' }]);
  assert.deepEqual(tools.map(c => c.block.id), ['a', 'b']); assert.equal(chunks.at(-2).usage.totalTokens, 14);
  assert.equal(chunks.at(-1).reason.kind, 'tool-calls');
});

test('prepared connection stays stable and failures/abort do not leak SDK data', async () => {
  let settings = defaults(), seen;
  const adapter = new NativeAdapter({ read: async () => settings }, {
    connect: async (_s, b) => ({ model: b.model, contextWindow: 262144, baseUrl: 'https://example.test/v1', auth: async () => ({ apiKey: 'secret' }) }),
    Provider: class { constructor(options) { seen = options; } async generate() { throw new Error('secret request body'); } },
  });
  const prepared = await adapter.prepareCall(PROVIDER, 'kimi-k3');
  settings = { ...settings, bindings: [{ ...settings.bindings[0], model: 'different' }] };
  const output = await Array.fromAsync(prepared.stream({ messages: [], purpose: 'session-title' }));
  assert.equal(seen.model, 'kimi-code/k3'); assert.equal(output[0].reason.kind, 'error'); assert.doesNotMatch(JSON.stringify(output), /secret/);
  const controller = new AbortController(); controller.abort();
  assert.equal((await Array.fromAsync(prepared.stream({ messages: [], signal: controller.signal })))[0].reason.kind, 'aborted');
});
