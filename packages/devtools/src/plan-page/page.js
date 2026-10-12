const PLAN = /*DATA*/ null;

const GITHUB = 'https://github.com/JulioFerrero/zilar/blob/main/';

const STATUS_LABEL = {
  planned: 'planned',
  todo: 'todo',
  'in-progress': 'in progress',
  review: 'review',
  merged: 'merged',
  blocked: 'blocked',
};

const ICON = {
  check:
    '<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 11.2 3.3 8l1.1-1.1 2.1 2.1 5-5L12.7 5z"/></svg>',
};

function $(id) {
  return document.getElementById(id);
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pct(part, total) {
  return total === 0 ? 0 : (part / total) * 100;
}

function chip(status) {
  const label = STATUS_LABEL[status] ?? status;
  const icon = status === 'merged' ? ICON.check : '';
  return `<span class="chip ${esc(status)}">${icon}${esc(label)}</span>`;
}

function renderHeader() {
  const { merged, total } = PLAN.overall;
  const done = Math.round(pct(merged, total));
  $('pct').textContent = `${done}%`;
  $('progress-note').textContent = `${merged} of ${total} items merged`;
  $('overall').innerHTML = `<i style="width:${done}%"></i>`;
  $('intro').textContent = PLAN.intro;
  $('updated').textContent = `Updated ${PLAN.updated}`;
  $('meta').textContent = `${PLAN.audits.length} audits · ${PLAN.waves.length} waves`;
}

function renderPills(counts) {
  return Object.entries(counts)
    .map(
      ([key, value]) =>
        `<span class="pill ${esc(key.toLowerCase())}">${esc(key)} <b>${value}</b></span>`,
    )
    .join('');
}

function renderAudit(audit) {
  const doc = audit.doc.split('/').pop() ?? audit.doc;
  const highlights = audit.highlights.map((text) => `<li>${esc(text)}</li>`).join('');
  return (
    `<article class="audit">` +
    `<h3>${esc(audit.title)}</h3>` +
    `<p class="meta"><span class="muted">${esc(audit.model)}</span> · ` +
    `<a href="${GITHUB}${esc(audit.doc)}">${esc(doc)}</a></p>` +
    `<div class="pills">${renderPills(audit.counts)}</div>` +
    `<ul class="highlights">${highlights}</ul>` +
    `</article>`
  );
}

function renderItem(item) {
  const task =
    item.task === null
      ? ''
      : item.file === null
        ? `<span class="task" title="task id">${esc(item.task)}</span>`
        : `<a class="task" href="${GITHUB}${esc(item.file)}">${esc(item.task)}</a>`;
  const ref = item.ref === null ? '' : `<span class="ref">${esc(item.ref)}</span>`;
  return (
    `<li class="item">` +
    chip(item.status) +
    `<span class="item-body"><span class="title">${esc(item.title)}</span>${ref}</span>` +
    task +
    `</li>`
  );
}

function renderWave(wave) {
  const done = pct(wave.merged, wave.total).toFixed(1);
  return (
    `<article class="wave">` +
    `<div class="wave-head"><h3>${esc(wave.title)}</h3>` +
    `<span class="wave-count">${wave.merged}/${wave.total}</span></div>` +
    `<p class="note">${esc(wave.goal)}</p>` +
    `<span class="bar"><i style="width:${done}%"></i></span>` +
    `<ul class="items">${wave.items.map(renderItem).join('')}</ul>` +
    `</article>`
  );
}

function renderAudits() {
  $('audits').innerHTML = PLAN.audits.map(renderAudit).join('');
}

function renderWaves() {
  $('waves').innerHTML = PLAN.waves.map(renderWave).join('');
}

renderHeader();
renderAudits();
renderWaves();
