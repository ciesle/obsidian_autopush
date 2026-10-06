'use strict';

const { Plugin, PluginSettingTab, Setting, Notice, FileSystemAdapter } = require('obsidian');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DEFAULTS = { enabled: true, pullOnStartup: true, nodePath: 'node', gitPath: 'git', commitMessage: 'vault: auto backup {date}' };

module.exports = class AutoPushOnClose extends Plugin {
  async onload() {
    this.settings = { ...DEFAULTS, ...await this.loadData() };
    if (!(this.app.vault.adapter instanceof FileSystemAdapter)) return;
    this.vaultPath = this.app.vault.adapter.getBasePath();
    this.pluginPath = path.join(this.vaultPath, this.app.vault.configDir, 'plugins', this.manifest.id);
    const { launch } = require(path.join(this.pluginPath, 'launcher.js'));
    this.launch = launch;
    this.logDirectory = path.join(this.pluginPath, 'logs');
    this.closeStarted = false;
    this.registerDomEvent(window, 'beforeunload', () => {
      if (!this.settings.enabled || this.closeStarted) return;
      this.closeStarted = true;
      this.startWorker();
    });
    this.addCommand({ id: 'push-now', name: '今すぐコミットしてpush', callback: () => this.startWorker() });
    this.addCommand({ id: 'show-last-result', name: '前回の結果を表示', callback: () => this.showLastResult() });
    this.addSettingTab(new AutoPushSettings(this.app, this));
    this.addCommand({ id: 'pull-now', name: '今すぐpull', callback: () => this.startWorker('pull') });
    this.app.workspace.onLayoutReady(() => {
      this.showLastResult(true);
      if (this.settings.pullOnStartup) this.startWorker('pull');
    });
  }

  startWorker(operation = 'push') {
    try {
      const child = this.launch({ nodePath: this.settings.nodePath, workerPath: path.join(this.pluginPath, 'worker.js'),
        logDirectory: this.logDirectory, options: {
          vaultPath: this.vaultPath, gitPath: this.settings.gitPath,
          commitMessage: this.settings.commitMessage, operation, delayMs: operation === 'pull' ? 0 : 2000,
        }, onError: (error) => new Notice(`Auto Pull & Push: 起動失敗 (${error.message})。設定と launcher.log を確認してください。`, 10000),
      });
      if (operation === 'pull' && child && typeof child.once === 'function') {
        child.once('exit', (code) => {
          if (code === 2) new Notice('Auto Pull & Push: 別の処理が実行中のためpullをスキップしました。');
          else this.showLastResult();
        });
      }
    } catch (error) {
      console.error('Auto Pull & Push:', error);
      new Notice(`Auto Pull & Push: ${error.message}`, 10000);
    }
  }

  showLastResult(onlyError = false) {
    try {
      const relative = execFileSync(this.settings.gitPath, ['rev-parse', '--git-path', 'autopush-on-close/last-result.json'],
        { cwd: this.vaultPath, encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      const result = JSON.parse(fs.readFileSync(path.resolve(this.vaultPath, relative), 'utf8'));
      if (!onlyError || result.status === 'error') {
        new Notice(`Auto Pull & Push (${result.finishedAt}): ${result.message}`, result.status === 'error' ? 15000 : 5000);
      }
    } catch (error) {
      if (!onlyError) new Notice('まだ結果がありません。プラグイン内の logs/launcher.log も確認してください。');
    }
  }

  async saveSettings() { await this.saveData(this.settings); }
};

class AutoPushSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    const plugin = this.plugin;
    containerEl.empty();
    containerEl.createEl('p', { text: '終了・再読み込み時に、保管庫の未追跡ファイルと変更・削除をコミットして追跡先へpushします。Gitの無視設定に従います。' });
    new Setting(containerEl).setName('終了時の自動push').addToggle((toggle) =>
      toggle.setValue(plugin.settings.enabled).onChange(async (value) => {
        plugin.settings.enabled = value; await plugin.saveSettings();
      }));
    new Setting(containerEl).setName('起動時の自動pull').setDesc('変更がない保管庫をfast-forwardで更新します。失敗時は通知します。').addToggle((toggle) =>
      toggle.setValue(plugin.settings.pullOnStartup).onChange(async (value) => {
        plugin.settings.pullOnStartup = value; await plugin.saveSettings();
      }));
    new Setting(containerEl).setName('今すぐpull').addButton((button) =>
      button.setButtonText('pull').onClick(() => plugin.startWorker('pull')));
    for (const [key, name, description] of [
      ['nodePath', 'Node.js の実行ファイル', 'Node.js 18以上。見つからない場合は絶対パスを指定してください。'],
      ['gitPath', 'Git の実行ファイル', '見つからない場合は絶対パスを指定してください。'],
      ['commitMessage', 'コミットメッセージ', '{date} は実行時の日時に置き換わります。'],
    ]) {
      new Setting(containerEl).setName(name).setDesc(description).addText((text) =>
        text.setValue(plugin.settings[key]).onChange(async (value) => {
          plugin.settings[key] = value.trim() || DEFAULTS[key]; await plugin.saveSettings();
        }));
    }
    new Setting(containerEl).setName('今すぐ実行').setDesc('保管庫の変更を実際にコミットしてpushします。')
      .addButton((button) => button.setButtonText('コミットしてpush').onClick(() => plugin.startWorker()));
    new Setting(containerEl).setName('前回の結果').addButton((button) =>
      button.setButtonText('表示').onClick(() => plugin.showLastResult()));
  }
}
