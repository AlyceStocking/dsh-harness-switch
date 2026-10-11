import test from 'node:test';
import assert from 'node:assert/strict';
import { promptParts, importWithImages } from '../src/images.js';
import { EngineAdapter } from '../src/engine.js';
import { PROVIDER } from '../src/native.js';
import { defaults } from '../src/settings.js';

test('ordered text and image attachments become multimodal SDK parts without reading arbitrary paths', async () => {
  const refs = [];
  const attachments = { async readImage(ref) { refs.push(ref); return { ref: { mediaType: 'image/png' }, data: Buffer.from('fixture') }; } };
  const input = [{ type: 'text', text: 'first' }, { type: 'image', attachment: { attachmentId: 'a' } }, { type: 'text', text: 'last' }];
  const parts = await promptParts(input, attachments);
  assert.deepEqual(parts.map(p => p.type), ['text', 'image_url', 'text']);
  assert.equal(parts[1].imageUrl.url, 'data:image/png;base64,Zml4dHVyZQ==');
  assert.deepEqual(refs, [{ attachmentId: 'a' }]);
  await assert.rejects(promptParts([{ type: 'image', path: 'private-file' }], attachments));
  await assert.rejects(promptParts(input));
  const abort = new AbortController(); abort.abort();
  await assert.rejects(promptParts(input, attachments, abort.signal));
});

test('foreign image history supplies visual parts instead of base64 as plain imported text', async () => {
  const attachments = { async readImage() { return { ref: { mediaType: 'image/png' }, data: Buffer.from('fixture') }; } };
  const imported = await importWithImages([{ role: 'user', content: [{ type: 'tool-result', content: [{ type: 'image', attachment: { attachmentId: 'a' } }] }] }], attachments);
  assert.equal(imported.images[0].type, 'image_url');
  assert.match(JSON.stringify(imported.history), /Prior conversation image 1/);
  assert.doesNotMatch(JSON.stringify(imported.history), /base64/);
});

test('embedded model advertises image input only when configured with image_in capability', async () => {
  const store = { async read() { return defaults(); } };
  for (const imageInput of [true, false]) {
    const adapter = new EngineAdapter(store, { connect: async () => ({ imageInput, contextWindow: 1000 }) });
    assert.equal((await adapter.resolveModel(PROVIDER, 'kimi-k3')).inputModalities.includes('image'), imageInput);
    assert.equal((await adapter.listModels(PROVIDER))[0].inputModalities.includes('image'), imageInput);
  }
});
