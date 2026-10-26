import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { presentationOverlay } from '../lib/presentation.js';
import { apply } from '../lib/ui-host.js';
import { createLauncherState } from '../lib/launcher-state.js';

test('deployment changes only presentation and the default preset', () => {
  const ids = [...presentationOverlay.matchAll(/^- id: (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(ids, ['agent-preset-registry', 'ui-settings-models', 'ui-settings-account', 'ui-brand-official', 'ui-settings-general']);
  assert.match(presentationOverlay, /credentialOnboarding: true/);
  assert.match(presentationOverlay, /id: ui-settings-account\n  disabled: true/);
  assert.doesNotMatch(presentationOverlay, /apiKey|credentials|llm-deepseek|llm-pi-ai/);
});

test('official page injection and sidebar module publish a credential-free workbench link', async () => {
  const originalBase = process.env.BIOINFO_BASE_URL;
  const originalToken = process.env.BIOINFO_TOKEN;
  process.env.BIOINFO_BASE_URL = 'http://127.0.0.1:4318';
  process.env.BIOINFO_TOKEN = 'private-test-token';
  try {
    let listener;
    let indexTransform;
    apply({
      effect(factory) { factory(); },
      webServer: { tapIndex(transform) { indexTransform = transform; return () => {}; } },
      on(name, handler) { assert.equal(name, 'webserver/index-inject'); listener = handler; },
    });
    assert.equal(indexTransform('<head><title>DeepSeek Harness</title></head>'), '<head><title>bioinfobuddy</title></head>');
    const table = [];
    listener(table);
    assert.deepEqual(table, [{ kind: 'global', name: '__BIOINFO_WORKBENCH__', value: { url: 'http://127.0.0.1:4318/workbench' } }]);
    let module;
    let titleChanged;
    const context = {
      window: { __ModuleLoader__: { load(value) { module = value; } } },
      __BIOINFO_WORKBENCH__: table[0].value,
      document: {
        title: 'DeepSeek Harness',
        querySelector() { return {}; },
        createElement() { return { dataset: {}, remove() {} }; },
        head: { appendChild() {} },
      },
      MutationObserver: class {
        constructor(callback) { titleChanged = callback; }
        observe() {}
        disconnect() {}
      },
    };
    vm.runInNewContext(await readFile(new URL('../lib/ui-client.js', import.meta.url), 'utf8'), context);
    assert.equal(module.id, 'dsh-plugin-bioinfo');
    const plugin = module.factory((name) => {
      assert.equal(name, 'react');
      return { createElement(type, props, ...children) { return { type, props, children }; } };
    });
    const components = new Map();
    plugin.apply({ effect(factory) { factory(); }, slots: {
      inject(_name, factory) { factory(); },
      register(entry, render) { components.set(entry.name, render); },
    } });
    const anchor = components.get('sidebar.footer.action')({ wide: true });
    assert.equal(anchor.type, 'a');
    assert.equal(anchor.props.href, 'http://127.0.0.1:4318/workbench');
    assert.equal(anchor.props.rel, 'noopener noreferrer');
    assert.doesNotMatch(JSON.stringify(anchor), /private-test-token/);
    const heading = components.get('conversation.hero.brand.mark')();
    assert.equal(heading.props.role, 'heading');
    assert.deepEqual(heading.children, ['开始生信分析']);
    assert.deepEqual(components.get('sidebar.brand.name')().children, ['bioinfobuddy']);
    assert.equal(context.document.title, 'bioinfobuddy');
    context.document.title = '表达量分析 — DeepSeek Harness';
    titleChanged();
    assert.equal(context.document.title, '表达量分析 — bioinfobuddy');
    titleChanged();
    assert.equal(context.document.title, '表达量分析 — bioinfobuddy');
  } finally {
    if (originalBase === undefined) delete process.env.BIOINFO_BASE_URL; else process.env.BIOINFO_BASE_URL = originalBase;
    if (originalToken === undefined) delete process.env.BIOINFO_TOKEN; else process.env.BIOINFO_TOKEN = originalToken;
  }
});

test('stopping during installation prevents marking completion and spawning the host', async () => {
  const state = createLauncherState();
  const signals = [];
  const child = { kill(signal) { signals.push(signal); } };
  state.attach(child);
  let finish;
  const installation = new Promise((resolve) => { finish = resolve; });
  let markerWritten = false;
  let hostStarted = false;
  const continuation = (async () => {
    await installation;
    state.check();
    markerWritten = true;
    state.check();
    hostStarted = true;
  })();
  state.stop();
  state.stop();
  finish();
  await assert.rejects(continuation, { name: 'AbortError' });
  assert.deepEqual(signals, ['SIGTERM']);
  assert.equal(markerWritten, false);
  assert.equal(hostStarted, false);
  assert.throws(() => state.attach(child), { name: 'AbortError' });
});
