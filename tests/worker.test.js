'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { run } = require('../worker');

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

function fixture(t, { upstream = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-autopush-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const vault = path.join(base, 'vault');
  const remote = path.join(base, 'remote.git');
  fs.mkdirSync(vault);
  git(base, 'init', '--bare', '-b', 'main', remote);
  git(vault, 'init', '-b', 'main');
  git(vault, 'config', 'user.name', 'Autopush Test');
  git(vault, 'config', 'user.email', 'autopush-test@example.invalid');
  fs.writeFileSync(path.join(vault, 'tracked.txt'), 'initial\n');
  git(vault, 'add', 'tracked.txt');
  git(vault, 'commit', '-m', 'initial');
  git(vault, 'remote', 'add', 'origin', remote);
  if (upstream) git(vault, 'push', '-u', 'origin', 'main');
  const options = { vaultPath: vault, delayMs: 0, timeoutMs: 10000 };
  const stateDir = path.join(vault, '.git', 'autopush-on-close');
  return { base, vault, remote, options, stateDir };
}

function worker(options) {
  return run(options);
}

test('commits and pushes changed, new, and deleted files', async (t) => {
  const { vault, remote, options } = fixture(t);
  fs.writeFileSync(path.join(vault, 'tracked.txt'), 'changed\n');
  fs.writeFileSync(path.join(vault, 'new.txt'), 'new\n');
  fs.writeFileSync(path.join(vault, 'delete-me.txt'), 'delete\n');
  git(vault, 'add', 'delete-me.txt');
  git(vault, 'commit', '-m', 'add deletion fixture');
  fs.unlinkSync(path.join(vault, 'delete-me.txt'));

  const result = await worker(options);

  assert.equal(result.status, 'success');
  assert.equal(result.committed, true);
  const remoteHead = git(remote, 'rev-parse', 'refs/heads/main');
  assert.equal(remoteHead, git(vault, 'rev-parse', 'HEAD'));
  assert.equal(git(vault, 'show', `${remoteHead}:tracked.txt`), 'changed');
  assert.equal(git(vault, 'show', `${remoteHead}:new.txt`), 'new');
  assert.throws(() => git(vault, 'show', `${remoteHead}:delete-me.txt`));
});

test('pushes existing local commits when the working tree is clean', async (t) => {
  const { vault, remote, options } = fixture(t);
  fs.writeFileSync(path.join(vault, 'tracked.txt'), 'already committed\n');
  git(vault, 'add', 'tracked.txt');
  git(vault, 'commit', '-m', 'existing local commit');

  const result = await worker(options);

  assert.equal(result.status, 'success');
  assert.equal(result.committed, false);
  assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), git(vault, 'rev-parse', 'HEAD'));
});

test('without upstream returns an error before staging changes', async (t) => {
  const { vault, options } = fixture(t, { upstream: false });
  fs.writeFileSync(path.join(vault, 'untracked.txt'), 'keep unstaged\n');

  const result = await worker(options);

  assert.equal(result.status, 'error');
  assert.match(result.message, /upstream/i);
  assert.equal(git(vault, 'diff', '--cached', '--name-only'), '');
  assert.equal(fs.existsSync(path.join(vault, 'untracked.txt')), true);
});

test('non-fast-forward push preserves the local commit and releases the lock', async (t) => {
  const { base, vault, remote, options, stateDir } = fixture(t);
  const competing = path.join(base, 'competing');
  git(base, 'clone', remote, competing);
  git(competing, 'config', 'user.name', 'Autopush Competitor');
  git(competing, 'config', 'user.email', 'autopush-competitor@example.invalid');
  fs.writeFileSync(path.join(competing, 'remote.txt'), 'remote change\n');
  git(competing, 'add', 'remote.txt');
  git(competing, 'commit', '-m', 'remote only');
  git(competing, 'push', 'origin', 'main');
  fs.writeFileSync(path.join(vault, 'local.txt'), 'local change\n');
  git(vault, 'add', 'local.txt');
  git(vault, 'commit', '-m', 'local only');
  const localHead = git(vault, 'rev-parse', 'HEAD');

  const result = await worker(options);

  assert.equal(result.status, 'error');
  assert.equal(git(vault, 'rev-parse', 'HEAD'), localHead);
  assert.equal(git(vault, 'show', `${localHead}:local.txt`), 'local change');
  assert.equal(fs.existsSync(path.join(stateDir, 'worker.lock')), false);
});

test('refuses to run while the worker lock exists', async (t) => {
  const { options, stateDir } = fixture(t);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'worker.lock'), 'busy');

  const result = await worker(options);

  assert.equal(result.status, 'busy');
});

test('refuses a vault path below the Git repository root', async (t) => {
  const { vault } = fixture(t);
  const subfolder = path.join(vault, 'nested');
  fs.mkdirSync(subfolder);

  await assert.rejects(
    worker({ vaultPath: subfolder, delayMs: 0, timeoutMs: 10000 }),
    /リポジトリのルート/,
  );
});

test('refuses to stage or commit while merge or rebase markers exist', async (t) => {
  for (const marker of ['MERGE_HEAD', 'rebase-merge']) {
    await t.test(marker, async (subtest) => {
      const { vault, options } = fixture(subtest);
      const initialHead = git(vault, 'rev-parse', 'HEAD');
      fs.writeFileSync(path.join(vault, 'untracked.txt'), 'keep unstaged\n');
      const markerPath = path.join(vault, '.git', marker);
      if (marker.endsWith('-merge')) fs.mkdirSync(markerPath);
      else fs.writeFileSync(markerPath, 'fixture\n');

      const result = await worker(options);

      assert.equal(result.status, 'error');
      assert.match(result.message, /操作が進行中/);
      assert.equal(git(vault, 'diff', '--cached', '--name-only'), '');
      assert.equal(git(vault, 'rev-parse', 'HEAD'), initialHead);
    });
  }
});


function advanceRemote(base, remote) {
  const other = path.join(base, 'other');
  git(base, 'clone', remote, other);
  git(other, 'config', 'user.name', 'Pull Test');
  git(other, 'config', 'user.email', 'pull@example.invalid');
  fs.writeFileSync(path.join(other, 'remote-note.txt'), 'remote note\n');
  git(other, 'add', '.');
  git(other, 'commit', '-m', 'remote update');
  git(other, 'push');
}

test('startup pull fast forwards and never pushes local commits', async t => {
  const { base, vault, remote, options } = fixture(t);
  advanceRemote(base, remote);
  const result = await worker({ ...options, operation: 'pull' });
  assert.equal(result.status, 'success');
  assert.equal(fs.readFileSync(path.join(vault, 'remote-note.txt'), 'utf8'), 'remote note\n');
  const remoteHead = git(remote, 'rev-parse', 'main');
  git(vault, 'commit', '--allow-empty', '-m', 'local only');
  const head = git(vault, 'rev-parse', 'HEAD');
  assert.equal((await worker({ ...options, operation: 'pull' })).status, 'success');
  assert.equal(git(vault, 'rev-parse', 'HEAD'), head);
  assert.equal(git(remote, 'rev-parse', 'main'), remoteHead);
});

test('startup pull preserves uncommitted edits, staged files and untracked files', async t => {
  for (const kind of ['unstaged', 'staged', 'untracked']) {
    await t.test(kind, async t => {
      const { base, vault, remote, options } = fixture(t);
      advanceRemote(base, remote);
      const file = kind === 'untracked' ? 'new.txt' : 'tracked.txt';
      fs.writeFileSync(path.join(vault, file), 'local edit\n');
      if (kind === 'staged') git(vault, 'add', file);
      const head = git(vault, 'rev-parse', 'HEAD');
      const status = git(vault, 'status', '--porcelain');
      const result = await worker({ ...options, operation: 'pull' });
      assert.equal(result.status, 'error');
      assert.match(result.message, /未コミット/);
      assert.equal(git(vault, 'rev-parse', 'HEAD'), head);
      assert.equal(git(vault, 'status', '--porcelain'), status);
      assert.equal(fs.readFileSync(path.join(vault, file), 'utf8'), 'local edit\n');
    });
  }
});

test('startup pull refuses divergence without merge, rebase or stash', async t => {
  const { base, vault, remote, options, stateDir } = fixture(t);
  advanceRemote(base, remote);
  git(vault, 'commit', '--allow-empty', '-m', 'local divergence');
  const head = git(vault, 'rev-parse', 'HEAD');
  const result = await worker({ ...options, operation: 'pull' });
  assert.equal(result.status, 'error');
  assert.equal(git(vault, 'rev-parse', 'HEAD'), head);
  assert.equal(git(vault, 'stash', 'list'), '');
  assert.equal(fs.existsSync(path.join(vault, '.git', 'MERGE_HEAD')), false);
  assert.equal(fs.existsSync(path.join(stateDir, 'worker.lock')), false);
});
