'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

async function run({ vaultPath, gitPath = 'git', commitMessage = 'vault: auto backup {date}', delayMs = 2000, timeoutMs = 120000, operation = 'push' }) {
  const vault = fs.realpathSync(vaultPath);
  const git = (args) => execFileSync(gitPath, args, {
    cwd: vault, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024,
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never',
      GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -oBatchMode=yes -oConnectTimeout=15' },
  });
  const root = fs.realpathSync(git(['rev-parse', '--show-toplevel']).trim());
  if (root !== vault) throw new Error('保管庫が Git リポジトリのルートではありません。');
  const gitFile = (name) => path.resolve(vault, git(['rev-parse', '--git-path', name]).trim());
  const stateDir = gitFile('autopush-on-close');
  fs.mkdirSync(stateDir, { recursive: true });
  const logPath = path.join(stateDir, 'worker.log');
  const lockPath = path.join(stateDir, 'worker.lock');
  let lock;
  try {
    lock = fs.openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') return { status: 'busy', message: '別の処理が実行中、またはロックが残っています。' };
    throw error;
  }
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  const log = (message) => {
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 1024 * 1024) {
      fs.renameSync(logPath, `${logPath}.previous`);
    }
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
  };
  let result;
  try {
    if (!['push', 'pull'].includes(operation)) throw new Error('不明な操作です。');
    log(`${operation} 開始`);
    // Give Obsidian's final disk writes time to finish. This is best effort.
    await delay(Math.max(0, Math.min(10000, Number(delayMs) || 0)));
    const branch = git(['symbolic-ref', '--quiet', 'HEAD']).trim();
    const tracking = git(['for-each-ref', '--format=%(upstream:remotename)%00%(upstream:remoteref)', branch]).trim().split('\0');
    if (!tracking[0] || !tracking[1]) throw new Error('現在のブランチに upstream が設定されていません。');
    for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'BISECT_LOG']) {
      if (fs.existsSync(gitFile(marker))) throw new Error(`Git の操作が進行中です: ${marker}`);
    }
    if (git(['diff', '--name-only', '--diff-filter=U']).trim()) throw new Error('未解決の競合があります。');
    if (git(['symbolic-ref', '--quiet', 'HEAD']).trim() !== branch) throw new Error('処理中にブランチが変更されました。');
    if (operation === 'pull') {
      if (git(['status', '--porcelain', '--untracked-files=all']).trim()) {
        throw new Error('未コミットの変更があるため起動時のpullを中止しました。変更を保存・コミットしてから再実行してください。');
      }
      const output = git(['-c', 'pull.rebase=false', '-c', 'pull.autostash=false', '-c', 'merge.autostash=false',
        'pull', '--ff-only', '--no-rebase', '--no-autostash', '--', tracking[0], tracking[1]]);
      log(output.trim());
      result = { status: 'success', operation, message: 'pull 完了', finishedAt: new Date().toISOString() };
    } else {
      git(['add', '--all', '--', '.']);
      let changed = false;
      try {
        git(['diff', '--cached', '--quiet', '--exit-code']);
      } catch (error) {
        if (error.status !== 1) throw error;
        changed = true;
      }
      let committed = false;
      if (changed) {
        const message = String(commitMessage).replaceAll('{date}', new Date().toISOString()).trim();
        if (!message) throw new Error('コミットメッセージが空です。');
        git(['commit', '-m', message]);
        committed = true;
        log('コミット完了');
      }
      if (git(['symbolic-ref', '--quiet', 'HEAD']).trim() !== branch) throw new Error('処理中にブランチが変更されました。');
      // Explicit destination follows upstream even when push.default/pushRemote differ.
      const output = git(['push', '--porcelain', '--', tracking[0], `${branch}:${tracking[1]}`]);
      log(output.trim());
      result = { status: 'success', operation, committed, message: 'push 完了', finishedAt: new Date().toISOString() };
    }
  } catch (error) {
    const detail = String(error.stderr || error.message).trim();
    result = { status: 'error', operation, message: detail, finishedAt: new Date().toISOString() };
    log(`失敗: ${detail}`);
  } finally {
    try {
      if (result) {
        const temporary = path.join(stateDir, `last-result.${process.pid}.tmp`);
        fs.writeFileSync(temporary, JSON.stringify(result, null, 2), { mode: 0o600 });
        fs.renameSync(temporary, path.join(stateDir, 'last-result.json'));
      }
    } finally {
      fs.closeSync(lock);
      fs.unlinkSync(lockPath);
    }
  }
  return result;
}

module.exports = { run };
if (require.main === module) {
  let options;
  try { options = JSON.parse(process.argv[2]); } catch (error) {
    console.error(`設定を読み込めません: ${error.message}`);
    process.exitCode = 1;
  }
  if (options) run(options).then((result) => {
    process.exitCode = result.status === 'error' ? 1 : result.status === 'busy' ? 2 : 0;
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
