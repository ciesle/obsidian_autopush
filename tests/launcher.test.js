'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { launch } = require('../launcher');

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-autopush-launcher-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('detached worker continues after the short-lived launcher process exits', async (t) => {
  const directory = temporaryDirectory(t);
  const vaultPath = path.join(directory, 'vault');
  const logDirectory = path.join(directory, 'logs');
  const markerPath = path.join(directory, 'worker-finished');
  const workerPath = path.join(directory, 'synthetic-worker.js');
  fs.mkdirSync(vaultPath);
  fs.writeFileSync(workerPath, [
    "'use strict';",
    "const fs = require('node:fs');",
    "const { setTimeout } = require('node:timers');",
    'const options = JSON.parse(process.argv[2]);',
    'setTimeout(() => fs.writeFileSync(options.markerPath, "completed\\n"), 100);',
    '',
  ].join('\n'));
  const parentScript = [
    "const { launch } = require('./launcher');",
    'launch({',
    '  workerPath: process.argv[1],',
    '  logDirectory: process.argv[2],',
    '  options: { vaultPath: process.argv[3], markerPath: process.argv[4] },',
    '});',
    '',
  ].join('\n');

  const parent = spawn(process.execPath, [
    '-e', parentScript, workerPath, logDirectory, vaultPath, markerPath,
  ], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore', windowsHide: true });
  const exitCode = await new Promise((resolve, reject) => {
    parent.once('error', reject);
    parent.once('exit', (code, signal) => {
      if (signal) reject(new Error(`launcher parent exited from ${signal}`));
      else resolve(code);
    });
  });
  assert.equal(exitCode, 0);

  const deadline = Date.now() + 3000;
  while (!fs.existsSync(markerPath) && Date.now() < deadline) await delay(25);
  assert.equal(fs.readFileSync(markerPath, 'utf8'), 'completed\n');
});

test('invalid Node executable logs the startup error and calls onError', async (t) => {
  const directory = temporaryDirectory(t);
  const vaultPath = path.join(directory, 'vault');
  const logDirectory = path.join(directory, 'logs');
  fs.mkdirSync(vaultPath);
  const error = await new Promise((resolve) => {
    launch({
      nodePath: path.join(directory, 'missing-node'),
      workerPath: path.join(directory, 'worker.js'),
      logDirectory,
      options: { vaultPath },
      onError: resolve,
    });
  });

  assert.equal(error.code, 'ENOENT');
  const log = fs.readFileSync(path.join(logDirectory, 'launcher.log'), 'utf8');
  assert.match(log, /ワーカー起動/);
  assert.match(log, /起動失敗/);
  assert.match(log, /ENOENT/);
});
