'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'dist', 'autopush-on-close');
fs.mkdirSync(target, { recursive: true });
for (const name of ['main.js', 'manifest.json', 'launcher.js', 'worker.js']) {
  fs.copyFileSync(path.join(root, name), path.join(target, name));
}
console.log(`配布用ファイル: ${target}`);
