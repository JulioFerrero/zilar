// Renders the Findings and Telegram parity sections of the Fix plan page. It
// runs after page.js in the same inline script, so it shares PLAN, GITHUB and
// the esc/$ helpers.

const SEVERITY_ORDER = ['P0', 'P1', 'P2', 'P3', 'Unrated'];
const SEVERITY_CLASS = { P0: 'p0', P1: 'p1', P2: 'p2', P3: 'p3', Unrated: 'unrated' };
const PARITY_ORDER = ['solid', 'weak', 'missing'];

const findingFilters = { severity: new Set(), audit: new Set(), state: new Set() };

function findingAudits() {
  return PLAN.audits.filter((audit) => PLAN.findings.some((f) => f.audit === audit.id));
}

function toggle(set, value) {
  if (set.has(value)) {
    set.delete(value);
  } else {
    set.add(value);
  }
}

function filterButton(dim, value, label, cls) {
  const on = findingFilters[dim].has(value);
  return (
    `<button type="button" class="fchip ${cls}${on ? ' on' : ''}" ` +
    `data-dim="${esc(dim)}" data-value="${esc(value)}" aria-pressed="${on}">` +
    `${esc(label)}</button>`
  );
}

function renderFilters() {
  const severity = SEVERITY_ORDER.map((sev) =>
    filterButton('severity', sev, sev, `sev ${SEVERITY_CLASS[sev]}`),
  ).join('');
  const audit = findingAudits()
    .map((entry) => filterButton('audit', entry.id, entry.id, 'audit'))
    .join('');
  const state =
    filterButton('state', 'open', 'open', 'state') +
    filterButton('state', 'fixed', 'fixed', 'state');
  $('finding-filters').innerHTML =
    `<span class="fgroup"><span class="flabel">Severity</span>${severity}</span>` +
    `<span class="fgroup"><span class="flabel">Audit</span>${audit}</span>` +
    `<span class="fgroup"><span class="flabel">State</span>${state}</span>`;
  for (const button of $('finding-filters').querySelectorAll('button[data-dim]')) {
    button.addEventListener('click', () => {
      toggle(findingFilters[button.dataset.dim], button.dataset.value);
      renderFilters();
      renderFindings();
    });
  }
}

function findingVisible(finding) {
  if (findingFilters.severity.size > 0 && !findingFilters.severity.has(finding.severity)) {
    return false;
  }
  if (findingFilters.audit.size > 0 && !findingFilters.audit.has(finding.audit)) return false;
  if (findingFilters.state.size > 0) {
    const state = finding.fixed ? 'fixed' : 'open';
    if (!findingFilters.state.has(state)) return false;
  }
  return true;
}

function renderFinding(finding) {
  const platform =
    finding.platform === null ? '' : `<span class="fplat">${esc(finding.platform)}</span>`;
  const fixed =
    finding.fixedBy === null
      ? ''
      : `<a class="ffixed" href="${GITHUB}${esc(finding.fixedBy.file)}">` +
        `fixed by ${esc(finding.fixedBy.task)}</a>`;
  return (
    `<li class="finding">` +
    `<span class="fid">${esc(finding.id)}</span>` +
    `<span class="fsev ${SEVERITY_CLASS[finding.severity]}">${esc(finding.severity)}</span>` +
    platform +
    `<span class="ftitle">${esc(finding.title)}</span>` +
    fixed +
    `</li>`
  );
}

function renderFindingGroup(audit, list) {
  const doc = audit.doc.split('/').pop() ?? audit.doc;
  const open = list.some((finding) => finding.severity === 'P0' || finding.severity === 'P1');
  return (
    `<details class="faudit"${open ? ' open' : ''}>` +
    `<summary><h3>${esc(audit.title)}</h3><span class="fcount">${list.length}</span></summary>` +
    `<p class="meta"><span class="muted">${esc(audit.id)}</span> · ` +
    `<a href="${GITHUB}${esc(audit.doc)}">${esc(doc)}</a></p>` +
    `<ul class="flist">${list.map(renderFinding).join('')}</ul>` +
    `</details>`
  );
}

function renderFindings() {
  const visible = new Map();
  for (const finding of PLAN.findings) {
    if (!findingVisible(finding)) continue;
    const list = visible.get(finding.audit);
    if (list === undefined) {
      visible.set(finding.audit, [finding]);
    } else {
      list.push(finding);
    }
  }
  const groups = [];
  for (const audit of findingAudits()) {
    const list = visible.get(audit.id);
    if (list !== undefined && list.length > 0) groups.push(renderFindingGroup(audit, list));
  }
  $('findings').innerHTML =
    groups.length > 0 ? groups.join('') : '<p class="note">No finding matches these filters.</p>';
}

function parityClass(status) {
  return status === 'n/a' ? 'na' : status;
}

function parityTotals(axis) {
  const totals = { solid: 0, weak: 0, missing: 0 };
  for (const row of PLAN.parity) {
    if (totals[row[axis]] !== undefined) totals[row[axis]] += 1;
  }
  return totals;
}

function renderParity() {
  if (PLAN.parity.length === 0) return;
  const web = parityTotals('web');
  const mobile = parityTotals('mobile');
  const totals = PARITY_ORDER.map((key) => `${key} web ${web[key]} / mobile ${mobile[key]}`).join(
    ' · ',
  );
  const head =
    '<thead><tr><th scope="col">Feature</th><th scope="col">Web</th>' +
    '<th scope="col">Mobile</th><th scope="col">Evidence</th></tr></thead>';
  const body = PLAN.parity
    .map(
      (row) =>
        '<tr>' +
        `<th scope="row">${esc(row.feature)}</th>` +
        `<td class="pstat ${parityClass(row.web)}">${esc(row.web)}</td>` +
        `<td class="pstat ${parityClass(row.mobile)}">${esc(row.mobile)}</td>` +
        `<td class="pevidence">${esc(row.evidence)}</td>` +
        '</tr>',
    )
    .join('');
  $('parity').innerHTML =
    `<p class="note">${esc(totals)}</p>` +
    `<div class="parity-scroll"><table class="ptable">${head}<tbody>${body}</tbody></table></div>`;
}

renderFilters();
renderFindings();
renderParity();
