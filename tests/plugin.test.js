'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const mainWindow = new EventTarget();
  const launches = [];
  class Plugin {
    constructor() {
      this.cleanups = [];
      this.commands = [];
      this.manifest = { id: 'autopush-on-close' };
      this.app = { vault: { adapter: new FileSystemAdapter(), configDir: '.obsidian' },
        workspace: { onLayoutReady(callback) { this.ready = callback; } } };
    }
    async loadData() { return null; }
    registerDomEvent(target, type, handler) {
      target.addEventListener(type, handler);
      this.cleanups.push(() => target.removeEventListener(type, handler));
    }
    addCommand(command) { this.commands.push(command); }
    addSettingTab() {}
  }
  class FileSystemAdapter { getBasePath() { return '/tmp/mock-vault'; } }
  const api = { Plugin, FileSystemAdapter, PluginSettingTab: class {}, Setting: class {}, Notice: class {} };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8'), {
    module, console, window: mainWindow,
    require(name) {
      if (name === 'obsidian') return api;
      if (name.endsWith('/launcher.js')) return { launch: (options) => launches.push(options) };
      return require(name);
    },
  });
  return { plugin: new module.exports(), mainWindow, launches };
}

test('main-window unload launches one worker, without cancelling close', async () => {
  const { plugin, mainWindow, launches } = fixture();
  await plugin.onload();
  const event = new Event('beforeunload', { cancelable: true });
  mainWindow.dispatchEvent(event);
  mainWindow.dispatchEvent(new Event('beforeunload'));
  assert.equal(event.defaultPrevented, false);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].options.vaultPath, '/tmp/mock-vault');
  assert.equal(launches[0].options.delayMs, 2000);
});

test('disabled automation and unrelated popup close do not launch', async () => {
  const { plugin, mainWindow, launches } = fixture();
  await plugin.onload();
  new EventTarget().dispatchEvent(new Event('beforeunload'));
  plugin.settings.enabled = false;
  mainWindow.dispatchEvent(new Event('beforeunload'));
  assert.equal(launches.length, 0);
  plugin.commands.find((command) => command.id === 'push-now').callback();
  assert.equal(launches.length, 1);
});

test('plugin cleanup removes the close listener', async () => {
  const { plugin, mainWindow, launches } = fixture();
  await plugin.onload();
  for (const cleanup of plugin.cleanups) cleanup();
  mainWindow.dispatchEvent(new Event('beforeunload'));
  assert.equal(launches.length, 0);
});


test('layout ready pulls once and startup toggle disables it', async () => {
  const { plugin, launches } = fixture();
  plugin.showLastResult = () => {};
  await plugin.onload();
  assert.equal(launches.length, 0);
  plugin.app.workspace.ready();
  assert.equal(launches.length, 1);
  assert.equal(launches[0].options.operation, 'pull');
  assert.equal(launches[0].options.delayMs, 0);
  plugin.settings.pullOnStartup = false;
  plugin.app.workspace.ready();
  assert.equal(launches.length, 1);
  plugin.commands.find(command => command.id === 'pull-now').callback();
  assert.equal(launches.length, 2);
});
