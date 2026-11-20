/* Viewport-based metro overlay manager for tablet map performance.
 * The uploaded snapshot contains hundreds of duplicate POIs and >1,000
 * potential DOM overlays. Keep only actual metro stations and visible exits.
 * Never rebuild overlays during map drag; update only at moveend/zoomend.
 */
(function () {
  'use strict';
  function init(options) {
    var map = options.map, AMap = options.AMap;
    var groups = options.groups;
    var data = options.data || { stations: [], exits: [] };
    var lineColors = options.lineColors;
    var metroPoint = options.metroPoint;
    var stationRows = new Map(), exitRows = new Map();
    var activeStation = new Map(), activeExit = new Map();
    var pending = false, lastKey = '';
    function normalized(row) {
      if (!row || typeof row.location !== 'string') return null;
      var coords = row.location.split(',').map(Number);
      if (coords.length !== 2 || !coords.every(Number.isFinite)) return null;
      return { id: String(row.id || '').trim(), name: String(row.name || '').trim(),
        address: String(row.address || '').trim(), sname: String(row.sname || '').trim(), coords: coords };
    }
    function insertStation(row) {
      var item = normalized(row);
      if (item && item.id.startsWith('BV')) stationRows.set(item.id, item);
    }
    function insertExit(row) {
      var item = normalized(row);
      if (!item || !item.id.startsWith('BX')) return;
      if (!exitRows.has(item.id)) exitRows.set(item.id, item);
    }
    (data.stations || []).forEach(function (row) {
      if (String(row.id || '').trim().startsWith('BV')) {
        insertStation(row);
        (row.children || []).forEach(insertExit);
      } else insertExit(row);
    });
    (data.exits || []).forEach(insertExit);
    function inBounds(point, sw, ne) {
      return point[0] >= sw.lng && point[0] <= ne.lng &&
        point[1] >= sw.lat && point[1] <= ne.lat;
    }
    function makeMarker(item, station) {
      var lineNos = [...new Set((item.address.match(/\d+(?=号线)/g) || []))];
      var colors = lineNos.map(function (no) { return lineColors[no] || '#667085'; });
      var color = colors.length > 1 ? 'linear-gradient(135deg,' + colors.join(',') + ')' :
        (colors[0] || '#667085');
      var name = station ? item.name.replace(/\(地铁站\)|（地铁站）/g, '') :
        (item.sname || item.name);
      var content = metroPoint((station ? (lineNos.join('/') || 'M') + ' ' : '') + name, color);
      return new AMap.Marker({ position: item.coords, content: content,
        offset: new AMap.Pixel(-5, -5), zIndex: station ? 35 : 25 });
    }
    function syncLayer(rows, active, key, enabled, sw, ne, maxCount) {
      var desired = new Map();
      if (enabled) {
        for (var item of rows.values()) {
          if (inBounds(item.coords, sw, ne)) desired.set(item.id, item);
          if (desired.size >= maxCount) break;
        }
      }
      var toRemove=[], toAdd=[];
      for (var [id, oldMarker] of active.entries()) {
        if (!desired.has(id)) {
          toRemove.push(oldMarker);
          active.delete(id);
        }
      }
      for (var [id, item] of desired.entries()) {
        if (!active.has(id)) {
          var marker = makeMarker(item, key === 'stations');
          active.set(id, marker);
          toAdd.push(marker);
        }
      }
      if (toRemove.length) map.remove(toRemove);
      if (toAdd.length) map.add(toAdd);
      groups[key].splice(0, groups[key].length, ...active.values());
    }
    function update() {
      pending = false;
      var bounds = map.getBounds();
      if (!bounds || !bounds.getSouthWest || !bounds.getNorthEast) return;
      var sw = bounds.getSouthWest(), ne = bounds.getNorthEast();
      var zoom = map.getZoom(), layers = window.JinanStore?.get().layers || {};
      // Exit markers are the expensive part: render only when zoomed close enough.
      var stationVisible = layers.stations !== false && zoom >= 10.5;
      var exitsVisible = layers.exits !== false && zoom >= 15;
      var key = [zoom.toFixed(1),sw.lng.toFixed(4),sw.lat.toFixed(4),
        ne.lng.toFixed(4),ne.lat.toFixed(4),stationVisible,exitsVisible].join(':');
      if (key === lastKey) return;
      lastKey = key;
      syncLayer(stationRows, activeStation, 'stations', stationVisible, sw, ne, 130);
      syncLayer(exitRows, activeExit, 'exits', exitsVisible, sw, ne, 240);
    }
    function schedule() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(update);
    }
    // These events fire after the gesture, never per touchmove.
    map.on('moveend', schedule);
    map.on('zoomend', schedule);
    map.on('complete', schedule);
    schedule();
    return {
      update: function () { lastKey = ''; schedule(); },
      counts: { stations: stationRows.size, exits: exitRows.size },
      visible: function () { return { stations: activeStation.size, exits: activeExit.size }; }
    };
  }
  window.JinanMetroViewportInit = init;
})();