const MAP = /*DATA*/ null;
const dark = matchMedia('(prefers-color-scheme: dark)');
let hiddenExtra = false;

function readPalette() {
  const style = getComputedStyle(document.documentElement);
  const get = (name) => style.getPropertyValue(name).trim();
  palette = {
    green: get('--green'),
    amber: get('--amber'),
    orange: get('--orange'),
    red: get('--red'),
    test: get('--test'),
    mock: get('--mock'),
    generated: get('--generated'),
    live: get('--live'),
    group: get('--group'),
    groupInk: get('--group-ink'),
    leafInk: get('--leaf-ink'),
    bg: get('--bg'),
    ui: get('--f-ui'),
    mono: get('--f-data'),
  };
}

// One node per folder, one per file. Folders with a single subfolder are
// merged ("apps/server/src") so the map does not nest needlessly.
function buildTree(files) {
  const root = { name: 'zilar', path: '', children: [] };
  const dirs = new Map([['', root]]);
  for (const file of files) {
    const parts = file.path.split('/');
    let parent = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join('/');
      let dir = dirs.get(path);
      if (!dir) {
        dir = { name: parts[i], path, children: [] };
        dirs.set(path, dir);
        parent.children.push(dir);
      }
      parent = dir;
    }
    parent.children.push({
      name: parts[parts.length - 1],
      path: file.path,
      file,
      value: file.lines,
    });
  }
  const sum = (node) => {
    if (node.file) return;
    node.children.forEach(sum);
    node.value = node.children.reduce((s, c) => s + c.value, 0);
  };
  sum(root);
  const squash = (node) => {
    if (node.file) return node;
    node.children = node.children.map((child) => {
      let c = child;
      while (!c.file && c.children.length === 1 && !c.children[0].file) {
        const only = c.children[0];
        c = { ...only, name: `${c.name}/${only.name}` };
      }
      return squash(c);
    });
    return node;
  };
  squash(root);
  const link = (node, parent) => {
    node.parent = parent;
    (node.children ?? []).forEach((c) => link(c, node));
  };
  link(root, null);
  return root;
}

function visibleFiles() {
  return MAP.files.filter((f) => !hiddenExtra || f.cls === 'source' || f.cls === 'generated');
}

function renderHeader() {
  const t = MAP.totals;
  $('pct').textContent = fmt(t.byClass.source.lines);
  $('week').textContent = `source lines · ${signed(MAP.week.sourceDelta)} this week`;
  $('n-test').textContent = fmt(t.byClass.test.lines);
  $('n-mock').textContent = fmt(t.byClass.mock.lines);
  $('n-files').textContent = fmt(t.files);
  const over = $('n-over');
  over.textContent = fmt(t.over400);
  over.className = t.over400 === 0 ? 'ok' : 'bad';
}

function renderHistory() {
  const H = MAP.history;
  const W = 820,
    VH = 240,
    padL = 54,
    padR = 14,
    // Headroom above the top gridline so the "lines" title sits clear of the
    // top y-axis tick value.
    padT = 28,
    padB = 30;
  const max = Math.max(
    1,
    ...H.map((p) => p.source),
    ...H.map((p) => p.test),
    ...H.map((p) => p.mock),
  );
  const x = (i) => padL + (W - padL - padR) * (H.length <= 1 ? 0 : i / (H.length - 1));
  const y = (v) => padT + (VH - padT - padB) * (1 - v / max);
  const path = (key) =>
    H.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ');
  const grid = [0, max / 2, max]
    .map(
      (v) =>
        `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" class="grid"/>` +
        `<text x="${padL - 8}" y="${(y(v) + 4).toFixed(1)}" class="axis" text-anchor="end">${fmt(Math.round(v))}</text>`,
    )
    .join('');
  const first = H[0]?.date ?? '';
  const last = H[H.length - 1]?.date ?? '';
  // A date tick about every 3-4 days: the two ends plus evenly spaced days, so
  // no two labels end up next to each other on the narrow end of the axis.
  const tickCount = Math.max(2, Math.min(H.length, Math.round((H.length - 1) / 3.5) + 1));
  const tickIndex = (j) => Math.round((j * (H.length - 1)) / (tickCount - 1));
  const dateLabels = [...new Set(Array.from({ length: tickCount }, (_, j) => tickIndex(j)))]
    .map((i) => {
      const anchor = i === 0 ? 'start' : i === H.length - 1 ? 'end' : 'middle';
      return `<text x="${x(i).toFixed(1)}" y="${VH - 8}" class="axis" text-anchor="${anchor}">${H[i]?.date ?? ''}</text>`;
    })
    .join('');
  $('chart').innerHTML =
    `<svg viewBox="0 0 ${W} ${VH}" role="img" aria-label="Lines per day from ${first} to ${last}">` +
    grid +
    `<text x="4" y="14" class="axis">lines</text>` +
    `<path d="${path('source')}" class="h-source"/>` +
    `<path d="${path('test')}" class="h-test"/>` +
    `<path d="${path('mock')}" class="h-mock"/>` +
    dateLabels +
    '</svg>';
}

function renderMerges() {
  const max = Math.max(1, ...MAP.merges.map((m) => Math.abs(m.net)));
  $('merges').innerHTML = MAP.merges
    .map((m) => {
      const w = (Math.abs(m.net) / max) * 50;
      const side = m.net <= 0 ? `right:50%;width:${w}%` : `left:50%;width:${w}%`;
      const cls = m.net <= 0 ? 'cut' : 'grow';
      return (
        `<div class="mrow">` +
        `<span class="mtitle"><b>${esc(m.id)}</b> ${esc(m.title)}</span>` +
        `<span class="mmeta muted">+${fmt(m.added)} −${fmt(m.removed)} · ${m.created} new · ${m.deleted} gone</span>` +
        `<span class="mtrack"><i class="${cls}" style="${side}"></i></span>` +
        `<span class="mnet ${cls}">${signed(m.net)}</span>` +
        `</div>`
      );
    })
    .join('');
}

function renderPackages() {
  const max = Math.max(1, ...MAP.packages.map((p) => p.sourceLines));
  const row = (p) =>
    `<div class="row">` +
    `<span>${esc(p.name)}</span>` +
    `<span class="opt-sm">${fmt(p.files)}</span>` +
    `<span class="ef"><span class="bar"><i style="width:${((p.sourceLines / max) * 100).toFixed(1)}%"></i></span><b>${fmt(p.sourceLines)}</b></span>` +
    `<span class="opt-sm">${fmt(p.testLines)}</span>` +
    `<span>${fmt(p.over400)}</span>` +
    `<span class="muted">${p.biggest === null ? '—' : esc(`${p.biggest.path.split('/').pop()} ${fmt(p.biggest.lines)}`)}</span>` +
    `</div>`;
  $('packages').innerHTML = [
    '<div class="row head"><span>Package</span><span class="opt-sm">Files</span><span>Source</span><span class="opt-sm">Test</span><span>&gt;400</span><span>Biggest</span></div>',
    ...MAP.packages.map(row),
  ].join('');
}

function renderBiggest() {
  const max = Math.max(1, ...MAP.biggest.map((f) => f.lines));
  const mark = Math.min(100, (MAP.lineLimit / max) * 100);
  $('biggest').innerHTML = MAP.biggest
    .map(
      (f) =>
        `<div class="brow">` +
        `<span class="bpath">${esc(f.path)}</span>` +
        `<span class="btrack"><i class="${f.band}" style="width:${((f.lines / max) * 100).toFixed(1)}%"></i><u style="left:${mark.toFixed(2)}%"></u></span>` +
        `<span class="blines">${fmt(f.lines)}</span>` +
        `</div>`,
    )
    .join('');
}

function renderMeta() {
  const when = new Date(MAP.generatedAt).toISOString().slice(0, 16).replace('T', ' ');
  $('meta').textContent = `Generated ${when} UTC from ${MAP.commit} ${MAP.commitSubject}`;
}

readPalette();
zoom = buildTree(visibleFiles());
renderHeader();
renderHistory();
renderMerges();
renderPackages();
renderBiggest();
renderMeta();
layout();

$('hide-extra').addEventListener('change', (e) => {
  hiddenExtra = e.target.checked;
  zoom = buildTree(visibleFiles());
  hideTip();
  layout();
});
let resizeTimer;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(layout, 80);
}).observe(canvas);
dark.addEventListener('change', () => {
  readPalette();
  draw();
});
