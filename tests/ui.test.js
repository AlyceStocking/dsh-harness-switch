import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { defaults } from '../src/settings.js';

test('settings slot renders, edits a binding, and saves through authenticated RPC', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = []; const registrations = []; let dict; let factory;
  const context = { window: { __ModuleLoader__: { load(module) { factory = module.factory; } } }, AbortController, Date };
  vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), context);
  const plugin = factory(name => { assert.equal(name, 'react'); return React; });
  plugin.apply({ effect: fn => fn(), locale: { register(_ns, dictionaries) { dict = dictionaries.zh; return () => {}; }, bind: () => key => dict[key] },
    slots: { inject: (_name, fn) => fn(), register(options, component) { registrations.push({ options, component }); return () => {}; } },
    connection: { rpc: { call: async (channel, endpoint, payload) => {
      assert.equal(channel, '/harness-switch'); calls.push({ endpoint, payload });
      if (endpoint === 'settings/read') return { ok: true, value: { settings: defaults(), harnesses: [{ id: 'kimi-code', label: 'Kimi Code' }] } };
      if (endpoint === 'sessions/list') return { ok: true, value: [] };
      if (endpoint === 'settings/save') return { ok: true, value: payload };
      throw new Error('Unexpected endpoint');
    } } },
  });
  assert.equal(registrations.length, 1);
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => { root.render(React.createElement(registrations.find(r => r.options.name === 'settings.section').component)); });
    const click = async text => {
      const button = [...document.querySelectorAll('button')].find(b => b.textContent === text);
      assert.ok(button, text); await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    };
    assert.match(document.body.textContent, /不复制密钥/);
    assert.equal(document.querySelector('select').value, 'kimi-code');
    await click('添加模型绑定');
    assert.equal(document.querySelectorAll('select').length, 2);
    await click('移除');
    await click('保存配置');
    assert.equal(calls.filter(c => c.endpoint === 'settings/save').length, 1);
    assert.match(document.body.textContent, /已保存/);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
