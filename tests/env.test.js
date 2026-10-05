'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readEnv, expandHome } = require('../scripts/env');

function envFile(t, text) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autopush-env-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, '.env');
  fs.writeFileSync(file, text);
  return file;
}

test('reads quoted paths, comments and literal values without executing shell text', (t) => {
  const values = readEnv(envFile(t, `# local config\nVAULT_PATH="/path/with spaces" # vault\nGIT_PATH=git # executable\nNODE_PATH=\nexport COMMIT_MESSAGE='backup {date} # keep'\nLITERAL=$(do-not-execute)\n`));
  assert.deepEqual(values, { VAULT_PATH: '/path/with spaces', GIT_PATH: 'git', NODE_PATH: '',
    COMMIT_MESSAGE: 'backup {date} # keep', LITERAL: '$(do-not-execute)' });
});

test('rejects malformed settings instead of silently choosing a different vault', (t) => {
  assert.throws(() => readEnv(envFile(t, 'VAULT_PATH="unfinished\n')), /1 行目/);
  assert.throws(() => readEnv(envFile(t, 'not an assignment\n')), /1 行目/);
});

test('missing env is optional and home shortcuts expand', (t) => {
  const file = envFile(t, '');
  fs.unlinkSync(file);
  assert.deepEqual(readEnv(file), {});
  assert.equal(expandHome('~/Notes'), path.join(os.homedir(), 'Notes'));
  assert.equal(expandHome('/path/to/vault'), '/path/to/vault');
});
