import { createHash, randomUUID } from 'node:crypto';
import { copyFile, link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const packageName = '@local/dsh-harness-switch';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function retainArchive(profileDir, archive, version) {
  if (!/^[\w.+-]+$/.test(version)) throw new Error('Invalid package version');
  const bytes = await readFile(archive);
  const hash = sha256(bytes);
  const relative = `packages/local-dsh-harness-switch-${version}-${hash}.tgz`;
  const destination = join(profileDir, relative);
  await mkdir(dirname(destination), { recursive: true });
  // Publish only complete bytes. link is atomic and refuses to replace an existing archive.
  const staging = `${destination}.staging-${randomUUID()}`;
  try {
    await writeFile(staging, bytes, { flag: 'wx' });
    try { await link(staging, destination); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  } finally { await unlink(staging).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  if (sha256(await readFile(destination)) !== hash) throw new Error(`Archive verification failed: ${destination}`);
  const specifier = `file:./${relative}`;
  // A named spec prevents DSH's anchorPathSpec from rewriting ./ to an external absolute path.
  return { archive: destination, hash, specifier, installSpec: `${packageName}@${specifier}` };
}

function run(command, args, options = {}) {
  const child = spawnSync(command, args, { ...options, encoding: 'utf8', windowsHide: true });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`${command} failed (${child.status})\n${child.stdout || ''}${child.stderr || ''}`);
  return child.stdout;
}

export async function installProfile(options) {
  const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  const home = resolve(options.home || process.env.DSH_HOME || join(homedir(), '.dsh'));
  const profile = options.profile || 'desktop';
  if (!/^[\w-]+$/.test(profile)) throw new Error('Invalid profile name');
  const profileDir = join(home, 'profiles', profile);
  const profileManifest = join(profileDir, 'package.json');
  if (!existsSync(profileManifest)) throw new Error(`Initialize this DSH profile first: ${profileDir}`);
  const desktopDir = resolve(options.desktopDir || join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness'));
  const executable = join(desktopDir, 'DeepSeek Harness.exe');
  const cli = join(desktopDir, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js');
  if (!existsSync(executable)) throw new Error(`Desktop executable not found: ${executable}`);
  const plan = { profileDir, package: `${manifest.name}@${manifest.version}`, source,
    changes: ['Retain a SHA256-named tgz under profile/packages; preserve older archives.',
      'Use a profile-relative file dependency; let the bundled DSH CLI update package.json and pnpm-lock.yaml.',
      'Keep existing bundle, model, credential and build-policy settings.'],
    executable };
  console.log(JSON.stringify(plan, null, 2));
  if (!options.apply) { console.log('Plan only. Fully quit Desktop, then pass --apply to install.'); return plan; }

  const backupDir = join(profileDir, '.plugin-manager', 'backups', `harness-switch-${Date.now()}-${randomUUID()}`);
  await mkdir(join(backupDir, 'packed'), { recursive: true });
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml']) {
    try { await copyFile(join(profileDir, name), join(backupDir, name), constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const npmCli = options.npmCli || join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!existsSync(npmCli)) throw new Error('npm CLI not found beside Node; specify --npm-cli <npm-cli.js>');
  const packed = JSON.parse(run(process.execPath, [npmCli, 'pack', source, '--ignore-scripts', '--json',
    '--pack-destination', join(backupDir, 'packed')], { cwd: source }));
  if (packed.length !== 1 || packed[0].name !== packageName) throw new Error('Unexpected packed package');
  const retained = await retainArchive(profileDir, join(backupDir, 'packed', packed[0].filename), packed[0].version);
  run(executable, ['--expose-internals', cli, 'plugin', '--profile', profile, 'add', retained.installSpec], {
    cwd: profileDir, env: { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  const installed = JSON.parse(await readFile(profileManifest, 'utf8'));
  const installedSpecifier = installed.dependencies?.[packageName];
  const normalized = spec => spec?.replaceAll('\\', '/').replace(/^file:\.\//, 'file:');
  if (normalized(installedSpecifier) !== normalized(retained.specifier)) throw new Error('DSH did not retain the profile-relative dependency');
  const installedPackageDir = join(profileDir, 'node_modules', '@local', 'dsh-harness-switch');
  const installedPackage = JSON.parse(await readFile(join(installedPackageDir, 'package.json'), 'utf8'));
  if (installedPackage.name !== packageName || installedPackage.version !== manifest.version) throw new Error('Installed package identity does not match the packed source');
  if (!installed.dsh?.profile?.bundles?.includes(packageName)) throw new Error('DSH did not register the plugin bundle');
  const sourceHash = sha256(await readFile(join(source, 'src', 'engine.js')));
  const installedHash = sha256(await readFile(join(installedPackageDir, 'src', 'engine.js')));
  if (sourceHash !== installedHash) throw new Error('Installed engine does not match the packed source');
  const receipt = { ...plan, ...retained, installedSpecifier, backupDir, installedAt: new Date().toISOString(), installedEngineHash: installedHash };
  await writeFile(join(backupDir, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(receipt, null, 2));
  return receipt;
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({ options: { profile: { type: 'string' }, home: { type: 'string' },
      'desktop-dir': { type: 'string' }, 'npm-cli': { type: 'string' }, apply: { type: 'boolean', default: false } } });
    await installProfile({ profile: values.profile, home: values.home, desktopDir: values['desktop-dir'],
      npmCli: values['npm-cli'], apply: values.apply });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
