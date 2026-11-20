(function () {
  'use strict';
  function element(tag, cls, label) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (label !== undefined) node.textContent = label;
    return node;
  }
  function action(text, fn, cls) {
    var button = element('button', cls || 'drawer-action', text);
    button.type = 'button';
    button.addEventListener('click', fn);
    return button;
  }
  function message(container, text) { container.appendChild(element('p', 'drawer-note', text)); }
  function init(config) {
    var store = window.JinanStore;
    if (!store) return;
    var map = config.map;
    var drawer = document.getElementById('quickDrawer');
    var buttons = Array.from(document.querySelectorAll('[data-drawer]'));
    var current = '';
    var groups = config.layers;
    var labels = { lines: '地铁线路', stations: '地铁站', exits: '地铁出入口', communityExits: '楼盘出入口' };
    function applyLayers() {
      var settings = store.get().layers;
      Object.keys(groups).forEach(function (key) {
        var overlays = groups[key];
        if (!overlays.length) return;
        if (settings[key]) map.add(overlays);
        else map.remove(overlays);
      });
    }
    function close() {
      current = '';
      drawer.hidden = true;
      buttons.forEach(function (btn) { btn.classList.remove('selected'); btn.setAttribute('aria-expanded', 'false'); });
    }
    function row(title, subtitle) {
      var wrap = element('div', 'drawer-list-row');
      wrap.appendChild(element('strong', '', title));
      if (subtitle) wrap.appendChild(element('small', '', subtitle));
      return wrap;
    }
    function locate(name, point) {
      if (point) map.setZoomAndCenter(17, point, false, 350);
      var input = document.getElementById('keyword');
      input.value = name;
      document.getElementById('search').click();
      close();
    }
    function build() {
      drawer.replaceChildren();
      if (!current) return;
      var title = { favorites: '我的收藏', recent: '最近搜索', layers: '地图图层',
        measurements: '保存的测距', data: '个人数据备份' }[current] || '';
      var heading = element('div', 'drawer-heading');
      heading.append(element('strong', '', title), action('关闭', close, 'drawer-close'));
      drawer.appendChild(heading);
      var data = store.get();
      if (current === 'favorites') {
        if (!data.favorites.length) message(drawer, '还没有收藏。搜索楼盘后，点击列表右侧的 ☆ 即可收藏。');
        data.favorites.forEach(function (f) {
          var item = row(f.name, f.address);
          item.append(action('定位', function () { locate(f.name, [f.lng, f.lat]); }));
          item.append(action('移除', function () { store.removeFavorite(f.id); }));
          drawer.appendChild(item);
        });
      } else if (current === 'recent') {
        if (!data.recent.length) message(drawer, '搜索过的小区会保留在这里，方便下次快速定位。');
        data.recent.forEach(function (keyword) {
          drawer.appendChild(action(keyword, function () { locate(keyword); }, 'history-chip'));
        });
      } else if (current === 'layers') {
        Object.keys(labels).forEach(function (key) {
          var label = element('label', 'drawer-switch');
          var checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = data.layers[key];
          checkbox.addEventListener('change', function () {
            store.setLayer(key, checkbox.checked);
            applyLayers();
          });
          label.append(checkbox, element('span', '', labels[key]));
          drawer.appendChild(label);
        });
        message(drawer, '关闭图层仅影响显示，不会删除已保存的数据。');
      } else if (current === 'measurements') {
        if (!data.measurements.length) message(drawer, '测距后点击“保存”，记录会显示在这里。');
        data.measurements.forEach(function (m) {
          var summary = Math.round(m.meters) + ' 米 · ' + (m.created ? m.created.slice(0, 10) : '');
          var item = row(m.title, summary);
          item.append(action('查看', function () {
            if (window.JinanMeasure) window.JinanMeasure.restore(m);
            close();
          }));
          item.append(action('删除', function () { store.removeMeasurement(m.id); }));
          drawer.appendChild(item);
        });
      } else if (current === 'data') {
        message(drawer, '收藏、搜索历史、地图视角、图层开关和测距结果只保存在本机。更换设备前可导出备份。');
        drawer.appendChild(action('导出 JSON 备份', function () {
          var blob = new Blob([store.exportData()], { type: 'application/json;charset=utf-8' });
          var url = URL.createObjectURL(blob);
          var link = element('a');
          link.href = url;
          link.download = 'jinan-metro-backup-' + new Date().toISOString().slice(0, 10) + '.json';
          document.body.appendChild(link);
          link.click(); link.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
        }));
        var file = document.createElement('input');
        file.type = 'file'; file.accept = '.json,application/json';
        file.className = 'backup-file';
        file.addEventListener('change', async function () {
          if (!file.files || !file.files[0]) return;
          try {
            store.importData(await file.files[0].text());
            applyLayers();
            alert('备份已导入。收藏和测距已恢复。');
          } catch (error) { alert('导入失败：' + error.message); }
          file.value = '';
        });
        drawer.append(action('从备份恢复', function () { file.click(); }), file);
      }
    }
    buttons.forEach(function (btn) {
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', function () {
        var next = btn.dataset.drawer;
        if (current === next) { close(); return; }
        current = next;
        drawer.hidden = false;
        buttons.forEach(function (node) {
          node.classList.toggle('selected', node === btn);
          node.setAttribute('aria-expanded', String(node === btn));
        });
        build();
      });
    });
    window.addEventListener('jinan:data-changed', function () { if (current) build(); });
    var restored = store.get().viewport;
    if (restored) map.setZoomAndCenter(restored.zoom, restored.center);
    var viewTimer;
    function saveViewport() {
      clearTimeout(viewTimer);
      viewTimer = setTimeout(function () {
        var center = map.getCenter();
        store.setViewport([center.lng, center.lat], map.getZoom());
      }, 900);
    }
    map.on('moveend', saveViewport);
    map.on('zoomend', saveViewport);
    var tools = document.getElementById('mapQuickTools');
    if (tools) {
      tools.append(action('⌖', function () { map.setZoomAndCenter(12, [117.12, 36.65]); }, 'map-quick-btn'));
      tools.append(action('+', function () { map.zoomIn(); }, 'map-quick-btn'));
      tools.append(action('−', function () { map.zoomOut(); }, 'map-quick-btn'));
    }
    window.JinanTabletUI = {
      toggleFavorite: function (favorite) { return store.toggleFavorite(favorite); },
      recordSearch: function (keyword) { store.addRecent(keyword); },
      syncNewOverlays: function () {
        var layers = store.get().layers;
        Object.keys(groups).forEach(function (key) {
          if (!layers[key]) map.remove(groups[key]);
        });
      },
      applyLayers: applyLayers
    };
    applyLayers();
  }
  window.JinanTabletUIInit = init;
})();