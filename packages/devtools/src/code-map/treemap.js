const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const fmt = (n) => n.toLocaleString('en-US');
const signed = (n) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${fmt(Math.abs(n))}`;
// The palette key of a file: its size band when it is source, else its class.
const tint = (file) => (file.cls === 'source' ? file.band : file.cls);

const canvas = $('map');
const ctx = canvas.getContext('2d');
const tip = $('tip');

let palette = {};
let zoom = null;
let trail = [];
let leaves = [];
let groups = [];
let hover = null;
let W = 1;
let H = 1;
let dpr = 1;

// Squarified treemap: rows of boxes whose aspect ratios stay close to square.
function squarify(nodes, x, y, w, h, out) {
  const items = nodes.filter((n) => n.value > 0).sort((a, b) => b.value - a.value);
  const total = items.reduce((s, n) => s + n.value, 0);
  if (!total || w <= 0 || h <= 0) return;
  const scale = (w * h) / total;
  const queue = items.map((n) => ({ n, a: n.value * scale }));
  let row = [];
  const worst = (r, side) => {
    if (!r.length) return Infinity;
    let s = 0,
      mx = 0,
      mn = Infinity;
    for (const it of r) {
      s += it.a;
      mx = Math.max(mx, it.a);
      mn = Math.min(mn, it.a);
    }
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  const place = () => {
    const s = row.reduce((t, it) => t + it.a, 0);
    if (w >= h) {
      const cw = s / h;
      let cy = y;
      for (const it of row) {
        const hh = it.a / cw;
        out.push({ n: it.n, x, y: cy, w: cw, h: hh });
        cy += hh;
      }
      x += cw;
      w -= cw;
    } else {
      const rh = s / w;
      let cx = x;
      for (const it of row) {
        const ww = it.a / rh;
        out.push({ n: it.n, x: cx, y, w: ww, h: rh });
        cx += ww;
      }
      y += rh;
      h -= rh;
    }
    row = [];
  };
  while (queue.length) {
    const side = Math.min(w, h);
    if (!row.length || worst([...row, queue[0]], side) <= worst(row, side)) row.push(queue.shift());
    else place();
  }
  if (row.length) place();
}

function layout() {
  const rect = canvas.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = Math.max(1, Math.round(rect.width));
  H = Math.max(1, Math.round(rect.height));
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  leaves = [];
  groups = [];
  const walk = (node, x, y, w, h, depth) => {
    const out = [];
    squarify(node.children, x, y, w, h, out);
    for (const r of out) {
      if (r.n.file) {
        leaves.push({ node: r.n, x: r.x, y: r.y, w: r.w, h: r.h });
        continue;
      }
      const head = r.w > 46 && r.h > 34 ? 14 : 0;
      groups.push({ node: r.n, x: r.x, y: r.y, w: r.w, h: r.h, head, depth });
      const pad = r.w > 8 && r.h > 8 ? 1 : 0;
      walk(r.n, r.x + pad, r.y + head + pad, r.w - pad * 2, r.h - head - pad * 2, depth + 1);
    }
  };
  walk(zoom, 0, 0, W, H, 0);
  renderCrumbs();
  draw();
}

function cushion(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  if (w < 3 || h < 3) return;
  const cx = x + w * 0.38,
    cy = y + h * 0.32;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.85);
  grad.addColorStop(0, 'rgba(255,255,255,0.34)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.05)');
  grad.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
}

function clip(text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return t.length > 1 ? `${t}…` : '';
}

function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, W, H);
  for (const g of groups) {
    ctx.fillStyle = palette.group;
    ctx.fillRect(g.x, g.y, g.w, g.h);
  }
  ctx.textBaseline = 'top';
  for (const l of leaves) {
    const gap = l.w > 4 && l.h > 4 ? 0.5 : 0;
    cushion(l.x + gap, l.y + gap, l.w - gap * 2, l.h - gap * 2, palette[tint(l.node.file)]);
    if (l.w > 70 && l.h > 16) {
      ctx.font = `11px ${palette.mono}`;
      ctx.fillStyle = palette.leafInk;
      ctx.fillText(clip(l.node.name, l.w - 8), l.x + 4, l.y + 3);
    }
  }
  ctx.textBaseline = 'middle';
  for (const g of groups) {
    if (!g.head) continue;
    ctx.font = `11px ${palette.ui}`;
    ctx.fillStyle = palette.groupInk;
    ctx.fillText(clip(`${g.node.name}  ${fmt(g.node.value)}`, g.w - 8), g.x + 4, g.y + 7);
  }
  if (hover) {
    ctx.strokeStyle = palette.leafInk;
    ctx.lineWidth = 2;
    ctx.strokeRect(hover.x + 1, hover.y + 1, hover.w - 2, hover.h - 2);
  }
}

function renderCrumbs() {
  trail = [];
  for (let n = zoom; n; n = n.parent) trail.unshift(n);
  $('crumbs').innerHTML =
    trail.length === 1
      ? 'Click a folder to zoom in.'
      : trail
          .map((n, i) =>
            i === trail.length - 1
              ? esc(n.name)
              : `<button type="button" data-i="${i}">${esc(n.name)}</button>`,
          )
          .join(' / ');
}

function leafAt(x, y) {
  return leaves.find((l) => x >= l.x && x < l.x + l.w && y >= l.y && y < l.y + l.h) ?? null;
}
function folderAt(x, y) {
  const hits = groups.filter((g) => x >= g.x && x < g.x + g.w && y >= g.y && y < g.y + g.h);
  return hits.at(-1) ?? null;
}

function tipHtml(leaf) {
  const f = leaf.node.file;
  const kind = f.cls === 'source' ? `${f.band} band` : f.cls;
  const delta = f.delta7 === 0 ? 'no change' : `${signed(f.delta7)} this week`;
  return `<b>${esc(f.path)}</b><br>${fmt(f.lines)} lines · ${kind}<br>${esc(delta)}`;
}

function showTip(leaf, x, y) {
  tip.innerHTML = tipHtml(leaf);
  tip.hidden = false;
  const left = Math.min(x + 14, W - tip.offsetWidth - 4);
  tip.style.left = `${Math.max(4, left)}px`;
  const below = y + 16 + tip.offsetHeight <= H;
  tip.style.top = `${below ? y + 16 : Math.max(4, y - tip.offsetHeight - 8)}px`;
}

function hideTip() {
  tip.hidden = true;
  hover = null;
}

function pointer(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const { x, y } = pointer(e);
  const leaf = leafAt(x, y);
  hover = leaf;
  if (leaf) showTip(leaf, x, y);
  else hideTip();
  draw();
});
canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType !== 'mouse') return;
  hideTip();
  draw();
});
canvas.addEventListener('click', (e) => {
  const { x, y } = pointer(e);
  const folder = folderAt(x, y);
  if (folder) {
    zoom = folder.node;
    hideTip();
    layout();
    return;
  }
  const leaf = leafAt(x, y);
  if (leaf) {
    hover = leaf;
    showTip(leaf, x, y);
    draw();
  }
});
$('crumbs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-i]');
  if (!b) return;
  zoom = trail[Number(b.dataset.i)] ?? zoom;
  hideTip();
  layout();
});
