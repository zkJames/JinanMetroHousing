(function () {
  'use strict';
  function init(options) {
    var map = options.map, AMap = options.AMap, store = window.JinanStore;
    var panel = document.getElementById('measurePanel');
    var output = document.getElementById('measureResult');
    var buttons = {
      tap: document.getElementById('segmentMeasure'),
      draw: document.getElementById('freehandMeasure'),
      walk: document.getElementById('walkMeasure')
    };
    var finish = document.getElementById('finishMeasure');
    var undo = document.getElementById('undoMeasure');
    var redo = document.getElementById('redoMeasure');
    var clear = document.getElementById('clearMeasure');
    var save = document.getElementById('saveMeasure');
    var mode = 'pan', segments = [], undone = [], tapPoints = [], tapUndone = [];
    var overlayLines = [], pendingLine = null, walkTool = null, walkPoints = [], walkMarkers = [];
    var walkingMeters = null, savedMeters = null, lastType = 'tap', requestToken = 0;
    var viewport = document.getElementById('container');
    var drawLayer = document.createElement('canvas');
    drawLayer.className = 'finger-draw-layer';
    drawLayer.setAttribute('aria-label', '在地图上按住手指画线测距');
    document.body.appendChild(drawLayer);
    var ctx = drawLayer.getContext('2d'), drawing = false, pixels = [], lastTime = 0;
    function distanceOf(points) {
      var sum = 0, rad = Math.PI / 180;
      for (var i = 1; i < points.length; i++) {
        var a = points[i - 1], b = points[i], dLat = (b[1] - a[1]) * rad;
        var dLng = (b[0] - a[0]) * rad, lat1 = a[1] * rad, lat2 = b[1] * rad;
        var x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
        sum += 6378137 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
      }
      return sum;
    }
    function totalDistance() {
      if (savedMeters !== null) return savedMeters;
      if (walkingMeters !== null) return walkingMeters;
      return segments.reduce(function (sum, path) { return sum + distanceOf(path); }, 0) +
        distanceOf(tapPoints);
    }
    function fmt(meters) {
      return meters >= 1000 ? (meters / 1000).toFixed(2) + ' 公里' : Math.round(meters) + ' 米';
    }
    function report(text) { output.textContent = text + ' · ' + fmt(totalDistance()); }
    function resize() {
      var ratio = Math.min(window.devicePixelRatio || 1, 2);
      drawLayer.width = Math.round(innerWidth * ratio);
      drawLayer.height = Math.round(innerHeight * ratio);
      drawLayer.style.width = innerWidth + 'px';
      drawLayer.style.height = innerHeight + 'px';
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    window.addEventListener('resize', resize);
    resize();
    function wipeCanvas() { ctx.clearRect(0, 0, innerWidth, innerHeight); }
    function removeLines() {
      if (overlayLines.length) map.remove(overlayLines);
      overlayLines = [];
      if (pendingLine) { map.remove(pendingLine); pendingLine = null; }
    }
    function polyline(path, color, dashed) {
      return new AMap.Polyline({
        path: path,
        strokeColor: color || '#e96943',
        strokeWeight: 5, strokeOpacity: .94,
        strokeStyle: dashed ? 'dashed' : 'solid', zIndex: 600,
        lineJoin: 'round', lineCap: 'round'
      });
    }
    function render() {
      removeLines();
      overlayLines = segments.filter(function (path) { return path.length > 1; })
        .map(function (path) { return polyline(path, '#e96943'); });
      if (overlayLines.length) map.add(overlayLines);
      if (tapPoints.length > 1) {
        pendingLine = polyline(tapPoints, '#159ba2', true);
        map.add(pendingLine);
      }
    }
    function resetWalk() {
      requestToken++;
      if (walkTool) { walkTool.clear(); walkTool = null; }
      if (walkMarkers.length) map.remove(walkMarkers);
      walkMarkers = [];
      walkPoints = []; walkingMeters = null;
    }
    function commitTap() {
      if (tapPoints.length > 1) {
        segments.push(tapPoints.slice());
        undone = [];
      }
      tapPoints = []; tapUndone = [];
      render();
    }
    function setMode(next) {
      if (mode === 'tap' && next !== 'tap') commitTap();
      if (next !== 'walk' && mode === 'walk' && walkPoints.length === 1) resetWalk();
      mode = next;
      drawing = false; wipeCanvas();
      drawLayer.style.pointerEvents = next === 'draw' ? 'auto' : 'none';
      drawLayer.style.display = next === 'draw' ? 'block' : 'none';
      map.setStatus({ dragEnable: next !== 'draw', zoomEnable: next !== 'draw',
        doubleClickZoom: next !== 'draw', pinchZoom: next !== 'draw' });
      Object.keys(buttons).forEach(function (key) {
        buttons[key].classList.toggle('active', key === mode);
        buttons[key].setAttribute('aria-pressed', String(key === mode));
      });
      panel.classList.toggle('is-drawing', next === 'draw');
      var labels = { pan: '浏览地图', tap: '轻点地图添加折点，点“完成”结束',
        draw: '按住手指画线，松开结束一笔；切到浏览模式可移动地图',
        walk: '依次点选步行起点和终点' };
      report(labels[mode]);
    }
    Object.keys(buttons).forEach(function (key) {
      buttons[key].addEventListener('click', function () {
        if (key === 'walk') { resetWalk(); savedMeters = null; }
        lastType = key;
        setMode(mode === key ? 'pan' : key);
      });
    });
    map.on('click', function (event) {
      if (mode === 'tap') {
        tapPoints.push([event.lnglat.lng, event.lnglat.lat]);
        tapUndone = []; savedMeters = null;
        render(); report('已添加 ' + tapPoints.length + ' 个折点');
      } else if (mode === 'walk') {
        if (walkPoints.length >= 2) return;
        var position = [event.lnglat.lng, event.lnglat.lat];
        walkPoints.push(position);
        var dot = new AMap.Marker({ position: position,
          title: walkPoints.length === 1 ? '起点' : '终点', zIndex: 700 });
        walkMarkers.push(dot); map.add(dot);
        if (walkPoints.length === 1) { report('已选起点，请点击终点'); return; }
        setMode('pan');
        output.textContent = '正在计算步行距离…';
        var thisToken = ++requestToken;
        if (walkTool) walkTool.clear();
        walkTool = new AMap.Walking({ map: map, hideMarkers: true });
        walkTool.search(walkPoints[0], walkPoints[1], function (status, result) {
          if (requestToken !== thisToken) return;
          if (status === 'complete' && result && result.routes && result.routes.length) {
            walkingMeters = Number(result.routes[0].distance);
            savedMeters = null;
            lastType = 'walk';
            // Keep only a short point pair for restoring location; route will be recalculated on restore.
            report('高德步行路径');
          } else {
            output.textContent = '未能规划步行路线，请确认网络并重新选择';
          }
        });
      }
    });
    function toMapPixel(event) {
      var rect = viewport.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }
    function acceptPixel(point, force) {
      var old = pixels[pixels.length - 1];
      if (!force && old && Math.hypot(point.x - old.x, point.y - old.y) < 6) return;
      if (pixels.length >= 2500) return;
      pixels.push(point);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
    drawLayer.addEventListener('pointerdown', function (event) {
      if (mode !== 'draw' || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      drawLayer.setPointerCapture(event.pointerId);
      drawing = true; pixels = []; undone = []; savedMeters = null;
      ctx.strokeStyle = '#e96943'; ctx.lineWidth = 5;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      var point = toMapPixel(event);
      ctx.beginPath(); ctx.moveTo(point.x, point.y); pixels.push(point);
    });
    drawLayer.addEventListener('pointermove', function (event) {
      if (!drawing || mode !== 'draw') return;
      event.preventDefault();
      acceptPixel(toMapPixel(event), false);
      if (performance.now() - lastTime > 130) {
        output.textContent = '正在绘制 · 已采样 ' + pixels.length + ' 个点';
        lastTime = performance.now();
      }
    });
    function endStroke(event) {
      if (!drawing) return;
      drawing = false;
      var point = toMapPixel(event);
      acceptPixel(point, true);
      var path = pixels.map(function (p) {
        var position = map.containerToLngLat(new AMap.Pixel(p.x, p.y));
        return [position.lng, position.lat];
      });
      pixels = []; wipeCanvas();
      if (path.length >= 2 && distanceOf(path) >= 1) {
        segments.push(path); undone = []; lastType = 'draw';
        render();
      }
      report('手绘 ' + segments.length + ' 段，可继续绘制');
    }
    drawLayer.addEventListener('pointerup', endStroke);
    drawLayer.addEventListener('pointercancel', function () {
      drawing = false; pixels = []; wipeCanvas(); report('绘制已中断，可继续');
    });
    finish.addEventListener('click', function () { setMode('pan'); report('测距已完成'); });
    undo.addEventListener('click', function () {
      if (mode === 'tap' && tapPoints.length) {
        tapUndone.push(tapPoints.pop());
      } else if (segments.length) {
        undone.push(segments.pop());
        savedMeters = null;
      }
      render(); report('已撤销');
    });
    redo.addEventListener('click', function () {
      if (mode === 'tap' && tapUndone.length) tapPoints.push(tapUndone.pop());
      else if (undone.length) segments.push(undone.pop());
      render(); report('已恢复');
    });
    clear.addEventListener('click', function () {
      segments = []; undone = []; tapPoints = []; tapUndone = [];
      savedMeters = null; resetWalk(); render(); setMode('pan');
      output.textContent = '已清除测距，请选择点选、手绘或步行';
    });
    save.addEventListener('click', function () {
      if (mode === 'tap') commitTap();
      var meters = totalDistance();
      if (!Number.isFinite(meters) || meters <= 0) {
        output.textContent = '请先完成一次有效测距，再保存';
        return;
      }
      var paths = segments.map(function (p) { return p.map(function (v) { return v.slice(); }); });
      if (lastType === 'walk' && walkPoints.length >= 2) paths = [walkPoints.map(function (v) { return v.slice(); })];
      var when = new Date();
      var title = ({ draw: '手绘测距', tap: '折线测距', walk: '步行路线' })[lastType] +
        ' ' + when.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      store.saveMeasurement({
        id: String(when.getTime()) + '-' + Math.random().toString(36).slice(2, 7),
        type: lastType, title: title, meters: meters,
        created: when.toISOString(), paths: paths
      });
      output.textContent = '已保存：' + title + ' · ' + fmt(meters);
    });
    function restore(measure) {
      resetWalk();
      tapPoints = []; tapUndone = []; undone = [];
      segments = measure.paths.map(function (path) { return path.map(function (p) { return p.slice(); }); });
      savedMeters = measure.meters;
      lastType = measure.type;
      render(); setMode('pan');
      if (overlayLines.length) {
        map.setFitView(overlayLines, false, [100, 100, 100, 100]);
      }
      output.textContent = measure.title + ' · ' + fmt(measure.meters) +
        (measure.type === 'walk' ? '（显示起终点连线，距离为保存时的步行数据）' : '');
    }
    window.JinanMeasure = { restore: restore };
    setMode('pan');
  }
  window.JinanMeasureInit = init;
})();