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
    'sw.js', 'js/featured-communities.js', 'js/featured-communities-ui.js', 'js/metro-viewport.js', 'api/config.mjs', 'api/poi.mjs', 'api/amap-proxy.mjs'
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
  assert.match(sw, /url\.pathname\.startsWith\(PREFIX \+ '\/api\/'\)/);
  assert.match(sw, /\/_AMapService\//);
  assert.doesNotMatch(sw, /restapi\.amap\.com/);
});

test('curated residential POIs and tablet viewport remain lightweight', () => {
  const vm = { window: {} };
  runInNewContext(read('js/featured-communities.js'), vm);
  const places = vm.window.JINAN_FEATURED_COMMUNITIES;
  assert.equal(places.length, 13);
  assert.equal(new Set(places.map(p => p.id)).size, places.length);
  assert.ok(places.some(p => p.aliases.includes('鲁投一号院')));
  assert.ok(places.some(p => p.aliases.includes('中海时光之镜')));
  assert.ok(places.some(p => p.type === 'sales'));
  assert.ok(places.every(p => p.location.every(Number.isFinite)));
  const page = read('jinan-map.html');
  assert.match(page, /JinanFeaturedInit/);
  assert.match(page, /JinanMetroViewportInit/);
  assert.match(page, /viewMode: "2D"/);
  assert.match(page, /\{ keyword \}/);
  const viewport = read('js/metro-viewport.js');
  assert.match(viewport, /map\.on\('moveend', schedule\)/);
  assert.match(viewport, /zoom >= 15/);
  assert.doesNotMatch(page, /addStationAndExits/);
  const sw = read('sw.js');
  assert.match(sw, /featured-communities-ui\.js/);
  assert.match(sw, /metro-viewport\.js/);
});

test('Our Seasons module works under /metro/ without touching root paths', () => {
  const html = read('jinan-map.html');
  const index = read('index.html');
  const sw = read('sw.js');
  const scoped = JSON.parse(read('manifest-metro.webmanifest'));
  assert.equal(scoped.start_url, '/metro/');
  assert.equal(scoped.scope, '/metro/');
  assert.equal(scoped.icons[0].src, '/metro/icons/metro.svg');
  assert.match(html, /\.\/api\/config/);
  assert.match(html, /\.\/api\/poi/);
  assert.match(html, /location\.pathname\.startsWith\("\/metro\/"/);
  assert.match(index, /\.\/jinan-map\.html/);
  assert.doesNotMatch(index, /href="\/jinan-map\.html"/);
  assert.match(sw, /PREFIX/);
  assert.match(sw, /self\.registration\.scope/);
});

test('Vercel maps the official AMap serviceHost prefix to server code', () => {
  const cfg = JSON.parse(read('vercel.json'));
  assert.ok(cfg.rewrites.some(row => row.source === '/_AMapService/:path*'));
  assert.match(read('api/poi.mjs'), /AMAP_WEB_SERVICE_KEY/);
  assert.match(read('api/amap-proxy.mjs'), /AMAP_SECURITY_JS_CODE/);
  assert.doesNotMatch(read('api/config.mjs'), /securityJsCode:/);
});

test('POI API accepts both keyword forms without exposing the Web Service key', async () => {
  const { default: handler } = await import('../api/poi.mjs');
  const previous = process.env.AMAP_WEB_SERVICE_KEY;
  const originalFetch = globalThis.fetch;
  process.env.AMAP_WEB_SERVICE_KEY = 'unit-test-secret-not-real';
  const queries = [];
  globalThis.fetch = async (url) => {
    const request = new URL(String(url));
    queries.push(request);
    return {
      ok: true, status: 200,
      async json() { return { status: '1', pois: [{id:'test-id',name:'地点',location:'117.1,36.6'}], count: '1' }; }
    };
  };
  function mockResponse() {
    const result = { code: 0, body: null };
    return {
      result,
      setHeader() { return this; },
      status(code) { result.code = code; return this; },
      json(body) { result.body = body; return this; }
    };
  }
  try {
    const byKeyword = mockResponse();
    await handler({ method:'GET', query:{keyword:'鲁投壹号院',children:'1'} }, byKeyword);
    assert.equal(byKeyword.result.code,200);
    assert.equal(byKeyword.result.body.pois.length,1);
    assert.equal(queries[0].searchParams.get('keywords'),'鲁投壹号院');
    const byKeywords = mockResponse();
    await handler({ method:'GET', query:{keywords:'趵突泉',children:'0'} }, byKeywords);
    assert.equal(byKeywords.result.code,200);
    assert.equal(queries[1].searchParams.get('keywords'),'趵突泉');
    const invalid = mockResponse();
    await handler({ method:'GET', query:{children:'1'} }, invalid);
    assert.equal(invalid.result.code,400);
    assert.equal(queries.length,2);
    assert.ok(!JSON.stringify(byKeyword.result.body).includes('unit-test-secret-not-real'));
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.AMAP_WEB_SERVICE_KEY;
    else process.env.AMAP_WEB_SERVICE_KEY = previous;
  }
});

test('viewport marker manager deduplicates exits and skips them until zoom 15', () => {
  let zoom = 12;
  let center = [117.1,36.7];
  let added = 0;
  let removed = 0;
  const events = {};
  const layers = { stations:true, exits:true };
  const map = {
    getZoom() { return zoom; },
    getBounds() { return {
      getSouthWest() { return {lng:center[0]-.03,lat:center[1]-.03}; },
      getNorthEast() { return {lng:center[0]+.03,lat:center[1]+.03}; }
    }; },
    on(name,cb) { events[name]=cb; },
    add(markers) { added += Array.isArray(markers)?markers.length:1; },
    remove(markers) { removed += Array.isArray(markers)?markers.length:1; }
  };
  class FakeMarker {}
  class FakePixel {}
  const store = {get() { return {layers}; }};
  const window = {JinanStore:store};
  runInNewContext(read('js/metro-viewport.js'), {
    window,requestAnimationFrame(fn) { fn(); },Map,Set,Number,Array,Math, String
  });
  const groups = {stations:[],exits:[]};
  const sample = {
    stations:[
      {id:'BV1',name:'花园东路(地铁站)',location:'117.1,36.7',address:'3号线',
        children:[{id:' BX1 ',name:'A口',location:'117.101,36.7',address:'3号线'}]},
      {id:'BX1',name:'A口',location:'117.101,36.7',address:'3号线'}
    ],
    exits:[{id:'BX1',name:'A口',location:'117.101,36.7',address:'3号线'}]
  };
  const manager = window.JinanMetroViewportInit({
    map,AMap:{Marker:FakeMarker,Pixel:FakePixel},groups,
    lineColors:{3:'#0044bb'},metroPoint:() => ({}),data:sample
  });
  assert.equal(manager.counts.stations,1);
  assert.equal(manager.counts.exits,1);
  assert.equal(manager.visible().stations,1);
  assert.equal(manager.visible().exits,0);
  zoom=16; events.zoomend();
  assert.equal(manager.visible().exits,1);
  const addedAfterZoom=added;
  events.moveend(); // unchanged viewport must not churn markers
  assert.equal(added,addedAfterZoom);
  layers.exits=false; manager.update();
  assert.equal(manager.visible().exits,0);
  center=[118,38]; events.moveend();
  assert.equal(manager.visible().stations,0);
  assert.ok(removed>=2);
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
