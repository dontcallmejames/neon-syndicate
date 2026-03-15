# District Tracer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone browser tool for tracing district polygon coordinates over the Neon Syndicate city background image, outputting a `DISTRICT_POLYGONS` JS object ready to paste into `game.html`.

**Architecture:** Single self-contained HTML file with no dependencies. Opens directly in a browser (no server required). Drag-and-drop image loading, SVG overlay for drawing, pan/zoom navigation, and a copy-ready export.

**Tech Stack:** Vanilla JS, SVG DOM API, FileReader / createObjectURL.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `tools/district-tracer.html` | Create | The complete tracer tool |

---

## Chunk 1: The tracer tool

### Task 1: Create `tools/district-tracer.html`

**Files:**
- Create: `tools/district-tracer.html`

No automated tests — this is a browser UI tool. Verification is manual.

- [ ] **Step 1: Create `tools/` directory and the file**

```bash
mkdir -p tools
```

Create `tools/district-tracer.html` with the following complete implementation:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>District Tracer — Neon Syndicate</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #030712; color: #e5e7eb; font-family: monospace; overflow: hidden; height: 100vh; }

    #drop-zone {
      position: fixed; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      border: 2px dashed #1e2a3a; color: #374151; font-size: 14px; letter-spacing: 2px;
      z-index: 100;
    }
    #drop-zone.drag-over { border-color: #00f5c4; color: #00f5c4; }
    #drop-zone.hidden { display: none; }

    #toolbar {
      position: fixed; top: 0; left: 0; right: 0; height: 40px;
      background: rgba(10,13,20,0.92); border-bottom: 1px solid #1e2a3a;
      display: flex; align-items: center; gap: 12px; padding: 0 14px;
      z-index: 50; backdrop-filter: blur(4px);
    }
    #mode-label { color: #00f5c4; font-size: 11px; letter-spacing: 1px; flex: 1; }
    .tb-btn {
      background: #0a0d14; border: 1px solid #1e2a3a; color: #9ca3af;
      padding: 4px 10px; font-family: monospace; font-size: 11px; cursor: pointer;
      border-radius: 3px; letter-spacing: 1px;
    }
    .tb-btn:hover:not(:disabled) { border-color: #00f5c4; color: #00f5c4; }
    .tb-btn:disabled { opacity: 0.3; cursor: not-allowed; }
    #district-count { color: #4b5563; font-size: 10px; white-space: nowrap; }

    #canvas {
      position: fixed; top: 40px; left: 0; right: 0; bottom: 0;
      width: 100%; height: calc(100vh - 40px); cursor: crosshair;
    }
    #canvas.panning { cursor: grabbing; }

    #name-prompt {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);
      background: #0a0d14; border: 1px solid #00f5c4; border-radius: 6px;
      padding: 16px; display: flex; flex-direction: column; gap: 10px;
      z-index: 200; min-width: 280px;
    }
    #name-prompt label { color: #6b7280; font-size: 10px; letter-spacing: 1px; }
    #district-name {
      background: #030712; border: 1px solid #374151; color: #e5e7eb;
      padding: 8px; font-family: monospace; font-size: 13px; border-radius: 4px;
      outline: none; width: 100%;
    }
    #district-name:focus { border-color: #00f5c4; }
    .prompt-btns { display: flex; gap: 8px; }

    #export-panel {
      position: fixed; bottom: 0; left: 0; right: 0; height: 40%;
      background: #0a0d14; border-top: 1px solid #00f5c4;
      display: flex; flex-direction: column; z-index: 200; padding: 12px; gap: 8px;
    }
    #export-header { display: flex; align-items: center; justify-content: space-between; }
    #export-header h3 { color: #00f5c4; font-size: 11px; letter-spacing: 2px; }
    #export-output {
      flex: 1; background: #030712; border: 1px solid #1e2a3a; color: #00f5c4;
      font-family: monospace; font-size: 11px; padding: 8px; resize: none; border-radius: 4px;
    }

    #tooltip {
      position: fixed; background: rgba(10,13,20,0.9); border: 1px solid #1e2a3a;
      color: #9ca3af; font-size: 10px; padding: 3px 8px; border-radius: 3px;
      pointer-events: none; z-index: 60; display: none;
    }
  </style>
</head>
<body>

<div id="drop-zone">
  <div style="font-size:32px;margin-bottom:12px;">🗺</div>
  <div>DROP CITY IMAGE HERE</div>
  <div style="font-size:11px;margin-top:8px;color:#1e2a3a;">or click to browse</div>
  <input type="file" accept="image/*" style="position:absolute;inset:0;opacity:0;cursor:pointer;">
</div>

<div id="toolbar">
  <span id="mode-label">DROP IMAGE TO BEGIN</span>
  <button class="tb-btn" id="undo-btn" disabled>⬅ UNDO</button>
  <button class="tb-btn" id="delete-btn" disabled>🗑 DELETE</button>
  <button class="tb-btn" id="export-btn" disabled>EXPORT JS</button>
  <span id="district-count">0 districts</span>
</div>

<svg id="canvas">
  <defs>
    <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
      <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#0d1520" stroke-width="0.5"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#grid)"/>
  <g id="map-group">
    <image id="bg-image" x="0" y="0"/>
    <g id="polygons-layer"/>
    <g id="preview-layer"/>
  </g>
</svg>

<div id="name-prompt" style="display:none">
  <label>DISTRICT NAME</label>
  <input id="district-name" type="text" placeholder="e.g. Central Core" autocomplete="off">
  <div class="prompt-btns">
    <button class="tb-btn" id="name-confirm" style="flex:1;border-color:#00f5c4;color:#00f5c4;">ADD DISTRICT</button>
    <button class="tb-btn" id="name-cancel">CANCEL</button>
  </div>
</div>

<div id="export-panel" style="display:none">
  <div id="export-header">
    <h3>DISTRICT_POLYGONS — paste into game.html</h3>
    <div style="display:flex;gap:8px;">
      <button class="tb-btn" id="copy-btn" style="border-color:#00f5c4;color:#00f5c4;">COPY</button>
      <button class="tb-btn" id="close-export">CLOSE</button>
    </div>
  </div>
  <textarea id="export-output" readonly></textarea>
</div>

<div id="tooltip"></div>

<script>
  // ── State ──────────────────────────────────────────────────────────────────
  let imgW = 0, imgH = 0;
  let tx = 0, ty = 0, scale = 1;
  let drawing = false;
  let currentVerts = [];    // [{x,y}] image coords
  let districts = [];       // [{name, points:[{x,y}]}]
  let selectedIdx = -1;
  let mousePos = { x: 0, y: 0 };
  let isPanning = false;
  let panStart = { x: 0, y: 0 };
  let panOrigin = { x: 0, y: 0 };

  const canvas      = document.getElementById('canvas');
  const mapGroup    = document.getElementById('map-group');
  const bgImage     = document.getElementById('bg-image');
  const polysLayer  = document.getElementById('polygons-layer');
  const previewLayer= document.getElementById('preview-layer');
  const modeLabel   = document.getElementById('mode-label');
  const undoBtn     = document.getElementById('undo-btn');
  const deleteBtn   = document.getElementById('delete-btn');
  const exportBtn   = document.getElementById('export-btn');
  const countLabel  = document.getElementById('district-count');
  const tooltip     = document.getElementById('tooltip');

  const COLORS = ['#00f5c4','#ff4d64','#ffd700','#a855f7','#3b82f6','#f97316','#10b981','#ec4899'];

  // ── Image loading ──────────────────────────────────────────────────────────
  function loadImage(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      imgW = img.naturalWidth;
      imgH = img.naturalHeight;
      bgImage.setAttribute('href', url);
      bgImage.setAttribute('width', imgW);
      bgImage.setAttribute('height', imgH);
      // No viewBox — SVG is pixel-space; pan/zoom is handled entirely by the
      // translate/scale transform on #map-group. Setting viewBox would
      // remap coordinate space and break clientToImage() math.
      fitToScreen();
      document.getElementById('drop-zone').classList.add('hidden');
      undoBtn.disabled = false;
      setMode('CLICK TO START DRAWING A DISTRICT  ·  Alt+drag or middle-click to pan  ·  Scroll to zoom');
    };
    img.src = url;
  }

  function fitToScreen() {
    const vw = canvas.clientWidth, vh = canvas.clientHeight;
    scale = Math.min(vw / imgW, vh / imgH) * 0.95;
    tx = (vw - imgW * scale) / 2;
    ty = (vh - imgH * scale) / 2;
    applyTransform();
  }

  const dropZone = document.getElementById('drop-zone');
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => { e.preventDefault(); loadImage(e.dataTransfer.files[0]); });
  dropZone.querySelector('input').addEventListener('change', e => loadImage(e.target.files[0]));

  // ── Transform ──────────────────────────────────────────────────────────────
  function applyTransform() {
    mapGroup.setAttribute('transform', `translate(${tx},${ty}) scale(${scale})`);
  }

  function clientToImage(cx, cy) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round((cx - rect.left - tx) / scale),
      y: Math.round((cy - rect.top  - ty) / scale),
    };
  }

  // ── Pan & zoom ──────────────────────────────────────────────────────────────
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.909;
    const rect = canvas.getBoundingClientRect();
    const ox = e.clientX - rect.left, oy = e.clientY - rect.top;
    tx = ox - (ox - tx) * factor;
    ty = oy - (oy - ty) * factor;
    scale *= factor;
    applyTransform();
    if (drawing) renderPreview();
  }, { passive: false });

  canvas.addEventListener('mousedown', e => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY };
      panOrigin = { x: tx, y: ty };
      canvas.classList.add('panning');
      e.preventDefault();
    }
  });

  window.addEventListener('mousemove', e => {
    if (isPanning) {
      tx = panOrigin.x + (e.clientX - panStart.x);
      ty = panOrigin.y + (e.clientY - panStart.y);
      applyTransform();
    }
    if (imgW > 0) {
      mousePos = clientToImage(e.clientX, e.clientY);
      if (drawing) renderPreview();
    }
    tooltip.style.left = (e.clientX + 14) + 'px';
    tooltip.style.top  = (e.clientY + 14) + 'px';
  });

  window.addEventListener('mouseup', () => {
    if (isPanning) { isPanning = false; canvas.classList.remove('panning'); }
  });

  // ── Drawing ────────────────────────────────────────────────────────────────
  canvas.addEventListener('click', e => {
    if (isPanning || !imgW || e.altKey || e.button !== 0) return;
    const pt = clientToImage(e.clientX, e.clientY);

    if (drawing && currentVerts.length >= 3) {
      const first = currentVerts[0];
      const dx = (pt.x - first.x) * scale, dy = (pt.y - first.y) * scale;
      if (Math.sqrt(dx*dx + dy*dy) < 12) { promptName(); return; }
    }

    if (drawing) {
      currentVerts.push(pt);
      renderPreview();
    } else {
      selectedIdx = -1; deleteBtn.disabled = true;
      renderAllPolygons();
      drawing = true;
      currentVerts = [pt];
      renderPreview();
      setMode('DRAWING  ·  click to add points  ·  click first point or Enter to close  ·  Backspace to undo  ·  Esc to cancel');
    }
  });

  canvas.addEventListener('dblclick', e => {
    if (!drawing || currentVerts.length < 3) return;
    e.preventDefault();
    promptName();
  });

  window.addEventListener('keydown', e => {
    const namePromptVisible = document.getElementById('name-prompt').style.display !== 'none';
    if (namePromptVisible) return;

    if (e.key === 'Backspace' && drawing) {
      e.preventDefault();
      if (currentVerts.length > 1) { currentVerts.pop(); renderPreview(); }
      else { cancelDrawing(); }
    }
    if (e.key === 'Enter' && drawing && currentVerts.length >= 3) promptName();
    if (e.key === 'Escape') {
      if (drawing) { cancelDrawing(); }
      else if (selectedIdx >= 0) { selectedIdx = -1; deleteBtn.disabled = true; renderAllPolygons(); setMode('CLICK TO START DRAWING A DISTRICT'); }
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !drawing && selectedIdx >= 0) {
      e.preventDefault();
      deleteSelected();
    }
  });

  function cancelDrawing() {
    drawing = false; currentVerts = [];
    clearPreview();
    setMode('CLICK TO START DRAWING A DISTRICT');
  }

  // ── Preview ────────────────────────────────────────────────────────────────
  function renderPreview() {
    previewLayer.innerHTML = '';
    if (currentVerts.length === 0) return;

    const sw = 2 / scale;

    for (let i = 1; i < currentVerts.length; i++) {
      const line = svgEl('line', {
        x1: currentVerts[i-1].x, y1: currentVerts[i-1].y,
        x2: currentVerts[i].x,   y2: currentVerts[i].y,
        stroke: '#00f5c4', 'stroke-width': sw,
      });
      previewLayer.appendChild(line);
    }

    // Preview line to cursor
    const last = currentVerts[currentVerts.length - 1];
    previewLayer.appendChild(svgEl('line', {
      x1: last.x, y1: last.y, x2: mousePos.x, y2: mousePos.y,
      stroke: '#00f5c460', 'stroke-width': sw * 0.8,
      'stroke-dasharray': `${6/scale} ${4/scale}`,
    }));

    // Closing line hint
    if (currentVerts.length >= 3) {
      const first = currentVerts[0];
      const dx = (mousePos.x - first.x) * scale, dy = (mousePos.y - first.y) * scale;
      const closeable = Math.sqrt(dx*dx + dy*dy) < 12;
      previewLayer.appendChild(svgEl('line', {
        x1: last.x, y1: last.y, x2: first.x, y2: first.y,
        stroke: closeable ? '#00f5c4' : '#00f5c420', 'stroke-width': sw * 0.8,
        'stroke-dasharray': `${4/scale} ${3/scale}`,
      }));
    }

    // Vertex dots
    currentVerts.forEach((v, i) => {
      const isFirst = i === 0 && currentVerts.length >= 3;
      previewLayer.appendChild(svgEl('circle', {
        cx: v.x, cy: v.y, r: (isFirst ? 8 : 4) / scale,
        fill: isFirst ? '#00f5c4' : '#fff', 'fill-opacity': isFirst ? '0.4' : '0.9',
        stroke: '#00f5c4', 'stroke-width': 1.5 / scale,
      }));
    });

    tooltip.style.display = 'block';
    tooltip.textContent = `${mousePos.x}, ${mousePos.y}`;
  }

  function clearPreview() {
    previewLayer.innerHTML = '';
    tooltip.style.display = 'none';
  }

  // ── Polygon rendering ──────────────────────────────────────────────────────
  function centroid(pts) {
    return {
      cx: Math.round(pts.reduce((s, p) => s + p.x, 0) / pts.length),
      cy: Math.round(pts.reduce((s, p) => s + p.y, 0) / pts.length),
    };
  }

  function renderAllPolygons() {
    polysLayer.innerHTML = '';
    districts.forEach((d, i) => {
      const color = COLORS[i % COLORS.length];
      const pts = d.points.map(p => `${p.x},${p.y}`).join(' ');
      const { cx, cy } = centroid(d.points);
      const sel = i === selectedIdx;

      const poly = svgEl('polygon', {
        points: pts, fill: color,
        'fill-opacity': sel ? '0.4' : '0.2',
        stroke: color, 'stroke-width': (sel ? 3 : 1.5) / scale,
        'stroke-opacity': '0.9',
      });
      poly.style.cursor = 'pointer';
      poly.addEventListener('click', e => { e.stopPropagation(); selectDistrict(i); });
      poly.addEventListener('mouseenter', () => { tooltip.style.display='block'; tooltip.textContent=d.name; });
      poly.addEventListener('mouseleave', () => { tooltip.style.display='none'; });
      polysLayer.appendChild(poly);

      const label = svgEl('text', {
        x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
        fill: '#fff', 'fill-opacity': '0.85', 'font-family': 'monospace',
        'font-size': 13 / scale, 'pointer-events': 'none',
      });
      label.textContent = d.name;
      polysLayer.appendChild(label);
    });

    countLabel.textContent = `${districts.length} district${districts.length !== 1 ? 's' : ''}`;
    exportBtn.disabled = districts.length === 0;
  }

  // ── Name prompt ────────────────────────────────────────────────────────────
  function promptName() {
    const prompt = document.getElementById('name-prompt');
    prompt.style.display = 'flex';
    const input = document.getElementById('district-name');
    input.value = '';
    setTimeout(() => input.focus(), 0);
  }

  function confirmName() {
    const name = document.getElementById('district-name').value.trim();
    if (!name) { document.getElementById('district-name').focus(); return; }
    districts.push({ name, points: [...currentVerts] });
    drawing = false; currentVerts = [];
    clearPreview();
    document.getElementById('name-prompt').style.display = 'none';
    renderAllPolygons();
    setMode('CLICK TO START DRAWING A DISTRICT');
  }

  function cancelName() {
    document.getElementById('name-prompt').style.display = 'none';
  }

  document.getElementById('name-confirm').addEventListener('click', confirmName);
  document.getElementById('name-cancel').addEventListener('click', cancelName);
  document.getElementById('district-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); confirmName(); }
    if (e.key === 'Escape') cancelName();
  });

  // ── Selection & deletion ───────────────────────────────────────────────────
  function selectDistrict(i) {
    if (drawing) return;
    selectedIdx = i; deleteBtn.disabled = false;
    renderAllPolygons();
    setMode(`"${districts[i].name}" selected  ·  Delete/Backspace to remove  ·  Esc to deselect`);
  }

  function deleteSelected() {
    if (selectedIdx < 0) return;
    districts.splice(selectedIdx, 1);
    selectedIdx = -1; deleteBtn.disabled = true;
    renderAllPolygons();
    setMode('CLICK TO START DRAWING A DISTRICT');
  }

  undoBtn.addEventListener('click', () => {
    if (drawing) {
      if (currentVerts.length > 1) { currentVerts.pop(); renderPreview(); }
      else cancelDrawing();
    }
  });
  deleteBtn.addEventListener('click', deleteSelected);

  // ── Export ─────────────────────────────────────────────────────────────────
  exportBtn.addEventListener('click', () => {
    // game.html expects: { 'Name': [[x,y],[x,y],...], ... }
    // Its own pointsStr() and centroid() functions consume this format directly.
    const lines = districts.map(d => {
      const pairs = d.points.map(p => `[${p.x},${p.y}]`).join(',');
      return `  ${JSON.stringify(d.name)}: [${pairs}]`;
    });
    document.getElementById('export-output').value =
      `const DISTRICT_POLYGONS = {\n${lines.join(',\n')}\n};`;
    document.getElementById('export-panel').style.display = 'flex';
  });

  document.getElementById('close-export').addEventListener('click', () => {
    document.getElementById('export-panel').style.display = 'none';
  });

  document.getElementById('copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('export-output').value);
    const btn = document.getElementById('copy-btn');
    btn.textContent = 'COPIED ✓';
    setTimeout(() => { btn.textContent = 'COPY'; }, 2000);
  });

  // ── SVG helper ─────────────────────────────────────────────────────────────
  function svgEl(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  function setMode(msg) { modeLabel.textContent = msg; }
</script>
</body>
</html>
```

- [ ] **Step 2: Verify manually**

Open `tools/district-tracer.html` directly in a browser (no server needed). Verify:

1. Drop zone appears on load
2. Drag `Neon Syndicate 3.png` onto the page → image loads, fills screen
3. Scroll to zoom in/out ✓
4. Alt+drag (or middle-click drag) to pan ✓
5. Click 4+ points to draw a polygon — preview line follows mouse ✓
6. First vertex dot is larger — clicking it closes the polygon ✓
7. Enter also closes the polygon ✓
8. Name prompt appears → type a name → ADD DISTRICT → polygon appears with label ✓
9. Click a completed polygon → it highlights, DELETE removes it ✓
10. Backspace during drawing removes last vertex ✓
11. Escape cancels drawing / deselects ✓
12. EXPORT JS button → textarea shows correct `DISTRICT_POLYGONS` format ✓
13. COPY button copies to clipboard ✓
14. Double-clicking also closes the polygon and opens the name prompt ✓
15. After panning and zooming, placed vertices still land on the correct pixel (coordinate accuracy check) ✓
16. Paste the exported `DISTRICT_POLYGONS` into `game.html` replacing the existing one — polygons render in correct positions over the background image ✓

- [ ] **Step 3: Commit**

```bash
git add tools/district-tracer.html
git commit -m "feat: add district tracer tool for mapping polygon coordinates"
```

---
