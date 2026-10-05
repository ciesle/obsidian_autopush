'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A deliberately small .env format: KEY=value, optional quotes and comments.
// Values are literal; shell commands and variable interpolation are never run.
function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const [index, line] of fs.readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) throw new Error(`.env の ${index + 1} 行目の形式が不正です。`);
    let value = match[2];
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0];
      const closing = value.indexOf(quote, 1);
      if (closing === -1 || !/^\s*(?:#.*)?$/.test(value.slice(closing + 1))) {
        throw new Error(`.env の ${index + 1} 行目の引用符が不正です。`);
      }
      value = value.slice(1, closing);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    values[match[1]] = value;
  }
  return values;
}

function expandHome(value) {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2));
  return value;
}

module.exports = { readEnv, expandHome };
