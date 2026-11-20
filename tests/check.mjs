import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(resolve(root,p),'utf8');

test('all frontend scripts and Vercel handlers parse', () => {
  const scripts = [
    'js/storage.js', 'js/tablet-ui.js', 'js/tablet-measure.js',
    'sw.js', 'api/config.mjs', 'api/poi.mjs', 'api/amap-proxy.mjs'
  ];
  scripts.forEach(file => {
    execFileSync(process.execPath, ['--check', resolve(root, file)]);
  });
  const inline = [...read('jinan-map.html').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  for (const match of inline) {
    if (match[1].trim()) new Function(match[1]);
  }
});

test('HTML includes tablet-first controls and PWA metadata', () => {
  const html = read('jinan-map.html');
  for (const id of ['segmentMeasure','freehandMeasure','walkMeasure','finishMeasure',
    'undoMeasure','redoMeasure','saveMeasure','clearMeasure','quickDrawer','mapQuickTools']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /rel="manifest"/);
  assert.match(html, /serviceHost/);
  assert.match(html, /JinanMeasureInit/);
  // Cross-check element IDs referenced by tablet modules against the rendered HTML:
  // a missing measurePanel previously caused a null.classList runtime crash.
  for (const path of ['js/tablet-measure.js', 'js/tablet-ui.js']) {
    const source = read(path);
    for (const [, id] of source.matchAll(/document\.getElementById\(['"]([^'"]+)['"]\)/g)) {
      assert.match(html, new RegExp('id="' + id + '"'), path + ' references missing #' + id);
    }
  }
  assert.doesNotMatch(html, /new AMap\.MouseTool/);
});

test('PWA caches only the shell, not remote or private API responses', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.display,'standalone');
  assert.equal(manifest.start_url,'/');
  assert.ok(manifest.icons.length);
  const sw = read('sw.js');
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(sw, /\/_AMapService\//);
  assert.doesNotMatch(sw, /restapi\.amap\.com/);
});

test('Vercel maps the official AMap serviceHost prefix to server code', () => {
  const cfg = JSON.parse(read('vercel.json'));
  assert.ok(cfg.rewrites.some(row => row.source === '/_AMapService/:path*'));
  assert.match(read('api/poi.mjs'), /AMAP_WEB_SERVICE_KEY/);
  assert.match(read('api/amap-proxy.mjs'), /AMAP_SECURITY_JS_CODE/);
  assert.doesNotMatch(read('api/config.mjs'), /securityJsCode:/);
});

test('favorites, history, measurements, backups and validation', () => {
  const values = new Map();
  const listeners = [];
  const browser = {
    dispatchEvent(event) { listeners.push(event.type); }
  };
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); }
  };
  runInNewContext(read('js/storage.js'), {
    window: browser, localStorage, Event: class Event { constructor(type) { this.type = type; } }
  });
  const store = browser.JinanStore;
  assert.ok(store);
  assert.equal(store.get().favorites.length,0);
  assert.equal(store.toggleFavorite({id:'a',name:'测试小区',lng:117.1,lat:36.6}),true);
  assert.equal(store.get().favorites[0].name,'测试小区');
  assert.equal(store.toggleFavorite({id:'a',name:'测试小区',lng:117.1,lat:36.6}),false);
  assert.equal(store.get().favorites.length,0);
  store.addRecent('鲁投一号院');
  store.addRecent('中海时光之镜');
  store.addRecent('鲁投一号院');
  assert.deepEqual(Array.from(store.get().recent), ['鲁投一号院','中海时光之镜']);
  store.saveMeasurement({id:'a',title:'测试距离',type:'draw',meters:456,
    created:'2026-11-20T01:00:00Z',paths:[[[117.1,36.6],[117.11,36.61]]]});
  assert.equal(store.get().measurements[0].meters,456);
  assert.ok(values.size);
  const backup=store.exportData();
  store.importData(backup);
  assert.equal(store.get().measurements.length,1);
  assert.throws(() => store.importData('{"app":"Other","data":{}}'), /不是本应用/);
  assert.ok(listeners.includes('jinan:data-changed'));
});
