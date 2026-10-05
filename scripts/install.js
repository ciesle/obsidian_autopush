'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readEnv, expandHome } = require('./env');

function install() {
  const root = path.resolve(__dirname, '..');
  const envFile = process.env.AUTOPUSH_ENV_FILE || path.join(root, '.env');
  const configValues = { ...readEnv(envFile), ...process.env };
  const vaultValue = process.argv[2] || configValues.VAULT_PATH;
  if (!vaultValue) throw new Error('.env に VAULT_PATH を指定するか、保管庫のパスを引数で指定してください。');
  const vault = fs.realpathSync(expandHome(vaultValue));
  const configDir = process.argv[3] || configValues.OBSIDIAN_CONFIG_DIR || '.obsidian';
  const gitPath = expandHome(configValues.GIT_PATH || 'git');
  if (path.isAbsolute(configDir) || configDir.split(/[\\/]/).includes('..')) throw new Error('設定フォルダーは保管庫内の相対パスを指定してください。');
  const source = path.join(root, 'dist', 'autopush-on-close');
  const names = ['main.js', 'manifest.json', 'launcher.js', 'worker.js'];
  for (const name of names) fs.accessSync(path.join(source, name), fs.constants.R_OK);
  const repoRoot = execFileSync(gitPath, ['rev-parse', '--show-toplevel'], { cwd: vault, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (fs.realpathSync(repoRoot) !== vault) throw new Error('保管庫が Git リポジトリのルートではありません。');
  execFileSync(gitPath, ['rev-parse', '--abbrev-ref', '@{upstream}'], { cwd: vault, stdio: ['ignore', 'pipe', 'pipe'] });
  const config = path.join(vault, configDir);
  if (!fs.existsSync(config)) throw new Error(`Obsidian の設定フォルダーがありません: ${config}`);
  const enabledPath = path.join(config, 'community-plugins.json');
  const enabled = fs.existsSync(enabledPath) ? JSON.parse(fs.readFileSync(enabledPath, 'utf8')) : [];
  if (!Array.isArray(enabled) || enabled.some((id) => typeof id !== 'string')) throw new Error('community-plugins.json の形式が不正です。');
  const id = 'autopush-on-close';
  const destination = path.join(config, 'plugins', id);
  // Check write permissions before changing the existing plugin configuration.
  fs.accessSync(config, fs.constants.W_OK);
  fs.mkdirSync(destination, { recursive: true });
  for (const name of names) fs.copyFileSync(path.join(source, name), path.join(destination, name));
  const dataPath = path.join(destination, 'data.json');
  const data = fs.existsSync(dataPath) ? JSON.parse(fs.readFileSync(dataPath, 'utf8')) : {
    enabled: true, nodePath: process.execPath, gitPath: 'git', commitMessage: 'vault: auto backup {date}',
  };
  for (const [key, variable] of [['nodePath', 'NODE_PATH'], ['gitPath', 'GIT_PATH'], ['commitMessage', 'COMMIT_MESSAGE']]) {
    if (configValues[variable]) data[key] = key === 'commitMessage' ? configValues[variable] : expandHome(configValues[variable]);
  }
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n');
  if (!enabled.includes(id)) {
    if (fs.existsSync(enabledPath)) fs.copyFileSync(enabledPath, `${enabledPath}.autopush-backup`);
    enabled.push(id);
    const temporary = `${enabledPath}.autopush-tmp`;
    fs.writeFileSync(temporary, JSON.stringify(enabled, null, 2) + '\n');
    fs.renameSync(temporary, enabledPath);
  }
  console.log(`配置・有効化設定を完了しました: ${destination}`);
  console.log('Obsidian が起動中なら、再読み込みするかコミュニティプラグイン画面で読み込んでください。制限モードが有効なら解除が必要です。');
}

try { install(); } catch (error) {
  console.error(`導入失敗: ${error.message}`);
  process.exitCode = 1;
}
