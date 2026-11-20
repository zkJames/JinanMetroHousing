/* Always-visible curated residential POIs (including one explicitly marked sales office).
 * They are independent of the live AMap Web Service and thus work during API outages.
 */
(function () {
  'use strict';
  function normalize(name) {
    return String(name || '').toLowerCase()
      .replace(/[\s·•.。()（）\-—_]/g, '')
      .replace(/壹/g, '一').replace(/雲/g, '云');
  }
  function init(options) {
    var map = options.map, AMap = options.AMap, store = window.JinanStore;
    var list = document.getElementById('communityList');
    var layerGroups = options.layers;
    var pois = window.JINAN_FEATURED_COMMUNITIES || [];
    var markers = [], items = new Map();
    var all = [];
    function favoriteOf(poi) {
      return { id: poi.id, name: poi.name, address: poi.address,
        lng: poi.location[0], lat: poi.location[1] };
    }
    function selected(poi) {
      return !!store && store.get().favorites.some(function (f) { return f.id === poi.id; });
    }
    function focus(poi) {
      map.setZoomAndCenter(16, poi.location, false, 320);
      list.querySelectorAll('.comparison-item.selected').forEach(function (el) { el.classList.remove('selected'); });
      var element = items.get(poi.id);
      if (element) {
        element.classList.add('selected');
        if (typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      var status = document.getElementById('searchStatus');
      if (status) status.textContent = (poi.type === 'sales' ? '已定位售楼处：' : '已定位已标注楼盘：') + poi.name;
    }
    function makeRow(poi) {
      var item = document.createElement('div');
      item.className = 'comparison-item featured-item';
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      var heading = document.createElement('strong');
      heading.textContent = poi.name;
      var description = document.createElement('small');
      description.className = 'featured-description';
      description.textContent = poi.address + (poi.type === 'sales' ? ' · 仅代表售楼处' : ' · POI 快照');
      var favorite = document.createElement('button');
      favorite.type = 'button'; favorite.className = 'favorite-toggle';
      function refresh() {
        var flag = selected(poi);
        favorite.textContent = flag ? '★' : '☆';
        favorite.setAttribute('aria-label', flag ? '取消收藏' : '收藏楼盘');
      }
      refresh();
      favorite.addEventListener('click', function (event) {
        event.stopPropagation();
        store.toggleFavorite(favoriteOf(poi));
        refresh();
      });
      item.append(favorite, heading, description);
      item.addEventListener('click', function (event) {
        if (event.target === favorite) return;
        focus(poi);
      });
      item.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); focus(poi);
        }
      });
      window.addEventListener('jinan:data-changed', refresh);
      items.set(poi.id, item);
      return item;
    }
    pois.forEach(function (poi) {
      if (!Array.isArray(poi.location) || poi.location.length !== 2 ||
          !poi.location.every(Number.isFinite)) return;
      var label = document.createElement('div');
      label.className = 'community-label featured-label' + (poi.type === 'sales' ? ' sales-label' : '');
      label.textContent = poi.name;
      var marker = new AMap.Marker({
        position: poi.location, title: poi.name + ' · ' + poi.address,
        content: label, offset: new AMap.Pixel(-10, -12), zIndex: 350
      });
      marker.on('click', function () { focus(poi); });
      markers.push(marker);
      all.push(poi);
    });
    // Add in one batch instead of triggering 13 incremental map refreshes.
    if (markers.length) map.add(markers);
    if (layerGroups) layerGroups.communities = markers;
    if (list && all.length) {
      list.replaceChildren();
      var counter = document.getElementById('featuredCount');
      if (counter) counter.textContent = String(all.length);
      all.forEach(function (poi) { list.appendChild(makeRow(poi)); });
    }
    // The default view should show all curated housing POIs; restore viewport
    // from localStorage later if the user already chose a preferred map area.
    if (markers.length && !store?.get().viewport) {
      map.setFitView(markers, false, [95, 320, 145, 80], 15);
    }
    function find(keyword) {
      var search = normalize(keyword);
      if (!search) return null;
      var exact = all.find(function (poi) {
        return [poi.name].concat(poi.aliases || []).some(function (v) { return normalize(v) === search; });
      });
      if (exact) return exact;
      if (search.length < 3) return null;
      var similar = all.filter(function (poi) {
        return [poi.name].concat(poi.aliases || []).some(function (v) {
          var n = normalize(v);
          return n.includes(search) || search.includes(n);
        });
      });
      return similar.length === 1 ? similar[0] : null;
    }
    return { find: find, focus: focus, all: all, markers: markers };
  }
  window.JinanFeaturedInit = init;
})();