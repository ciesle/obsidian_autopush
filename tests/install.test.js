'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const execute = (program, args, cwd, extraEnv = {}) => execFileSync(program, args, {
  env: { ...process.env, ...extraEnv }, cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});

test('installer preserves other plugins and user settings, and can be rerun', (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-autopush-install-'));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  const git = (...args) => execute('git', args, vault);
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  fs.writeFileSync(path.join(vault, 'note.md'), 'note\n');
  git('add', '.');
  git('commit', '-m', 'initial');
  git('remote', 'add', 'origin', '/tmp/nonexistent-autopush-remote');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('config', 'branch.main.remote', 'origin');
  git('config', 'branch.main.merge', 'refs/heads/main');
  const config = path.join(vault, '.obsidian');
  fs.mkdirSync(config);
  const enabledPath = path.join(config, 'community-plugins.json');
  fs.writeFileSync(enabledPath, JSON.stringify(['existing-plugin']));
  execute(process.execPath, [path.join(root, 'scripts', 'build.js')], root);
  const args = [path.join(root, 'scripts', 'install.js'), vault];
  const beforeHead = git('rev-parse', 'HEAD');
  execute(process.execPath, args, root);
  const installed = path.join(config, 'plugins', 'autopush-on-close');
  assert.deepEqual(JSON.parse(fs.readFileSync(enabledPath, 'utf8')), ['existing-plugin', 'autopush-on-close']);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${enabledPath}.autopush-backup`, 'utf8')), ['existing-plugin']);
  for (const name of ['main.js', 'launcher.js', 'worker.js', 'manifest.json']) {
    assert.equal(fs.readFileSync(path.join(installed, name), 'utf8'), fs.readFileSync(path.join(root, name), 'utf8'));
  }
  const dataPath = path.join(installed, 'data.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  assert.equal(data.nodePath, process.execPath);
  fs.writeFileSync(dataPath, JSON.stringify({ ...data, enabled: false, commitMessage: 'custom' }));
  execute(process.execPath, args, root);
  assert.deepEqual(JSON.parse(fs.readFileSync(enabledPath, 'utf8')), ['existing-plugin', 'autopush-on-close']);
  assert.equal(JSON.parse(fs.readFileSync(dataPath, 'utf8')).commitMessage, 'custom');
  assert.equal(JSON.parse(fs.readFileSync(dataPath, 'utf8')).enabled, false);
  assert.equal(git('rev-parse', 'HEAD'), beforeHead);
  const envFile = path.join(vault, 'install.env');
  fs.writeFileSync(envFile, `VAULT_PATH="${vault}"\nNODE_PATH="${process.execPath}"\nCOMMIT_MESSAGE="from env {date}"\n`);
  execute(process.execPath, [path.join(root, 'scripts', 'install.js')], root, { AUTOPUSH_ENV_FILE: envFile });
  assert.equal(JSON.parse(fs.readFileSync(dataPath, 'utf8')).commitMessage, 'from env {date}');
  assert.equal(JSON.parse(fs.readFileSync(dataPath, 'utf8')).nodePath, process.execPath);
  assert.equal(JSON.parse(fs.readFileSync(dataPath, 'utf8')).enabled, false);
});
