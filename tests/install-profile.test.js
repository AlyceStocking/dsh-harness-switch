import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { retainArchive } from '../scripts/install-profile.mjs';

test('install and upgrade retain immutable profile-local archives after the source is replaced', async t => {
  const root = await mkdtemp(resolve('tests/.tmp-installer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source.tgz');
  const profile = join(root, 'profile with spaces');
  await writeFile(source, 'release one');
  const first = await retainArchive(profile, source, '0.3.1');
  assert.equal(first.installSpec, `dsh-harness-switch@${first.specifier}`);
  assert.match(first.specifier, /^file:\.\/packages\/[^/]+\.tgz$/);
  assert.deepEqual(await retainArchive(profile, source, '0.3.1'), first);
  await writeFile(source, 'release two');
  const next = await retainArchive(profile, source, '0.3.1');
  assert.notEqual(next.archive, first.archive);
  await rm(source);
  assert.equal(await readFile(first.archive, 'utf8'), 'release one');
  assert.equal(await readFile(next.archive, 'utf8'), 'release two');
});

test('corrupted retained archives are refused instead of overwritten', async t => {
  const root = await mkdtemp(resolve('tests/.tmp-installer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source.tgz');
  await writeFile(source, 'release');
  const retained = await retainArchive(root, source, '0.3.1');
  await writeFile(retained.archive, 'corruption');
  await assert.rejects(retainArchive(root, source, '0.3.1'), /verification failed/);
  assert.equal(await readFile(retained.archive, 'utf8'), 'corruption');
});

test('concurrent publishers retain one complete archive without staging residue', async t => {
  const root = await mkdtemp(resolve('tests/.tmp-installer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source.tgz');
  const bytes = Buffer.alloc(2 * 1024 * 1024, 0xa5);
  await writeFile(source, bytes);
  const results = await Promise.all(Array.from({ length: 8 }, () => retainArchive(root, source, '0.3.1')));
  assert.ok(results.every(result => result.archive === results[0].archive));
  assert.deepEqual(await readFile(results[0].archive), bytes);
  assert.equal((await readdir(join(root, 'packages'))).length, 1);
});
