(function () {
  'use strict';
  var KEY = 'jinan-metro-tablet-v1';
  var LIMITS = { favorites: 80, recent: 20, measurements: 40 };
  function defaults() {
    return {
      version: 1, favorites: [], recent: [], measurements: [],
      layers: { lines: true, stations: true, exits: true, communityExits: true, communities: true },
      viewport: null
    };
  }
  function validPoint(point) {
    return Array.isArray(point) && point.length === 2 &&
      Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])) &&
      Math.abs(Number(point[0])) <= 180 && Math.abs(Number(point[1])) <= 90;
  }
  function clean(raw) {
    var value = raw && typeof raw === 'object' ? raw : {};
    var data = defaults();
    data.favorites = (Array.isArray(value.favorites) ? value.favorites : [])
      .filter(function (f) { return f && typeof f.name === 'string' && validPoint([f.lng, f.lat]); })
      .slice(0, LIMITS.favorites).map(function (f) {
        return { id: String(f.id || f.name).slice(0, 120), name: f.name.slice(0, 100),
          address: String(f.address || '').slice(0, 180), lng: Number(f.lng), lat: Number(f.lat) };
      });
    data.recent = (Array.isArray(value.recent) ? value.recent : [])
      .filter(function (s) { return typeof s === 'string' && s.trim(); })
      .slice(0, LIMITS.recent).map(function (s) { return s.slice(0, 100); });
    data.measurements = (Array.isArray(value.measurements) ? value.measurements : [])
      .filter(function (m) { return m && Array.isArray(m.paths) && Number.isFinite(Number(m.meters)); })
      .slice(0, LIMITS.measurements).map(function (m) {
        return {
          id: String(m.id || Date.now()).slice(0, 80),
          title: String(m.title || '未命名测距').slice(0, 100),
          type: ['tap', 'draw', 'walk'].includes(m.type) ? m.type : 'tap',
          meters: Math.max(0, Number(m.meters)),
          created: String(m.created || '').slice(0, 50),
          paths: m.paths.slice(0, 20).map(function (path) {
            return (Array.isArray(path) ? path : []).filter(validPoint).slice(0, 2000)
              .map(function (p) { return [Number(p[0]), Number(p[1])]; });
          }).filter(function (p) { return p.length >= 2; })
        };
      });
    if (value.layers && typeof value.layers === 'object') {
      Object.keys(data.layers).forEach(function (key) {
        if (typeof value.layers[key] === 'boolean') data.layers[key] = value.layers[key];
      });
    }
    if (value.viewport && validPoint(value.viewport.center) &&
        Number.isFinite(Number(value.viewport.zoom)) && value.viewport.zoom >= 3 && value.viewport.zoom <= 20) {
      data.viewport = { center: value.viewport.center.map(Number), zoom: Number(value.viewport.zoom) };
    }
    return data;
  }
  function read() {
    try { return clean(JSON.parse(localStorage.getItem(KEY) || 'null')); }
    catch (_) { return defaults(); }
  }
  var state = read();
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (_) { /* private mode or storage quota: keep this session functional */ }
    window.dispatchEvent(new Event('jinan:data-changed'));
  }
  function update(mutator) { mutator(state); state = clean(state); persist(); }
  window.JinanStore = {
    get: function () { return clean(state); },
    addRecent: function (keyword) {
      keyword = String(keyword || '').trim().slice(0, 100);
      if (!keyword) return;
      update(function (s) { s.recent = [keyword].concat(s.recent.filter(function (x) { return x !== keyword; })); });
    },
    toggleFavorite: function (favorite) {
      var existing = state.favorites.some(function (f) { return f.id === String(favorite.id); });
      update(function (s) {
        s.favorites = existing ? s.favorites.filter(function (f) { return f.id !== String(favorite.id); })
          : [favorite].concat(s.favorites);
      });
      return !existing;
    },
    removeFavorite: function (id) {
      update(function (s) { s.favorites = s.favorites.filter(function (f) { return f.id !== String(id); }); });
    },
    saveMeasurement: function (measure) {
      update(function (s) { s.measurements.unshift(measure); });
    },
    removeMeasurement: function (id) {
      update(function (s) { s.measurements = s.measurements.filter(function (m) { return m.id !== id; }); });
    },
    setLayer: function (key, checked) {
      if (!(key in state.layers)) return;
      update(function (s) { s.layers[key] = Boolean(checked); });
    },
    setViewport: function (center, zoom) {
      if (!validPoint(center) || !Number.isFinite(zoom)) return;
      state.viewport = { center: center.map(Number), zoom: Number(zoom) };
      // Frequent map gestures must not rebuild UI.
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
    },
    exportData: function () { return JSON.stringify({ app: 'JinanMetroHousing', data: state }, null, 2); },
    importData: function (text) {
      if (text.length > 2000000) throw new Error('备份文件过大');
      var parsed = JSON.parse(text);
      if (!parsed || parsed.app !== 'JinanMetroHousing' || !parsed.data || parsed.data.version !== 1) {
        throw new Error('不是本应用支持的备份文件');
      }
      state = clean(parsed.data);
      persist();
    }
  };
})();