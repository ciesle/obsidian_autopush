'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function launch({ nodePath = 'node', workerPath, logDirectory, options, onError = () => {} }) {
  fs.mkdirSync(logDirectory, { recursive: true });
  const logPath = path.join(logDirectory, 'launcher.log');
  if (fs.existsSync(logPath) && fs.statSync(logPath).size > 1024 * 1024) {
    fs.renameSync(logPath, `${logPath}.previous`);
  }
  const descriptor = fs.openSync(logPath, 'a', 0o600);
  let child;
  try {
    fs.writeSync(descriptor, `${new Date().toISOString()} ワーカー起動\n`);
    // The configured executable is external Node, not Obsidian/Electron.
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;
    child = spawn(nodePath, [workerPath, JSON.stringify(options)], {
      cwd: options.vaultPath, detached: true, stdio: ['ignore', descriptor, descriptor],
      windowsHide: true, env,
    });
    child.on('error', (error) => {
      fs.appendFileSync(logPath, `${new Date().toISOString()} 起動失敗: ${error.message}\n`);
      onError(error);
    });
    child.unref();
  } finally {
    fs.closeSync(descriptor);
  }
  return child;
}

module.exports = { launch };
