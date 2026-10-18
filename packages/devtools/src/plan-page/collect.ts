// Collects the data behind the Fix plan page: the audits, findings and waves from
// docs/plan/plan.json, with every wave item resolved to the live status in its work/
// task file (falling back to its BOARD.md row while a running task still says "todo").
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../effect-map/generate.js';
import { collectFindings, type AuditSource, type Finding } from './findings.js';

// Parses the Telegram parity matrix (section 2 of docs/audit/telegram-parity-audit.md)
// into one row per feature. Only tables whose header names the four parity columns are
// read, so the fix-plan and summary tables are ignored.
interface ParityRow {
  area: string | null;
  feature: string;
  web: string;
  mobile: string;
  evidence: string;
}

const HEADING = /^###\s+(.*)$/;
const HEADER = /^\|\s*(Telegram feature|Feature)\s*\|/;

function splitRow(line: string): string[] {
  const body = line.replace(/^\|/, '').replace(/\|$/, '');
  return body.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
}

export function parseParity(source: string): ParityRow[] {
  const rows: ParityRow[] = [];
  let area: string | null = null;
  let inTable = false;
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    const heading = HEADING.exec(line);
    if (heading !== null) {
      area = (heading[1] ?? '').replace(/^\d+(\.\d+)?\s+/, '');
      inTable = false;
      continue;
    }
    if (HEADER.test(line)) {
      inTable = true;
      continue;
    }
    if (!line.startsWith('|')) {
      inTable = false;
      continue;
    }
    if (!inTable) continue;
    const cells = splitRow(line);
    if (cells.length !== 4) continue;
    const [feature, web, mobile, evidence] = cells;
    if (feature === undefined || feature === '' || /^-+$/.test(feature)) continue;
    rows.push({ area, feature, web: web ?? '', mobile: mobile ?? '', evidence: evidence ?? '' });
  }
  return rows;
}

export type ItemStatus = 'planned' | 'todo' | 'in-progress' | 'review' | 'merged' | 'blocked';

export interface PlanAudit {
  id: string;
  title: string;
  doc: string;
  model: string;
  counts: Record<string, number>;
  highlights: string[];
}

export interface PlanItem {
  status: ItemStatus;
  task: string | null;
  ref: string | null;
  title: string;
  closes: string[];
  file: string | null;
}

export interface PlanWave {
  id: string;
  title: string;
  goal: string;
  items: PlanItem[];
  merged: number;
  total: number;
}

export interface PlanFinding extends Finding {
  fixed: boolean;
  fixedBy: { task: string; file: string } | null;
}

export interface PlanPage {
  title: string;
  updated: string;
  intro: string;
  audits: PlanAudit[];
  waves: PlanWave[];
  findings: PlanFinding[];
  parity: ParityRow[];
  overall: { merged: number; total: number };
}

export interface TaskInfo {
  status: ItemStatus;
  file: string;
}

interface RawItem {
  task?: string | undefined;
  ref?: string | undefined;
  title: string;
  closes?: string[] | undefined;
  status?: ItemStatus | undefined;
}

interface RawWave {
  id: string;
  title: string;
  goal: string;
  items: RawItem[];
}

interface RawAudit {
  id: string;
  title: string;
  doc: string;
  model: string;
  counts: Record<string, number>;
  highlights: string[];
}

export interface RawPlan {
  title: string;
  updated: string;
  intro: string;
  audits: RawAudit[];
  waves: RawWave[];
}

const KNOWN_STATUSES: readonly ItemStatus[] = [
  'planned',
  'todo',
  'in-progress',
  'review',
  'merged',
  'blocked',
];

function fail(where: string, expected: string): never {
  throw new Error(`plan.json: ${where} ${expected}`);
}

function asObject(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(where, 'must be an object');
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) fail(where, 'must be an array');
  return value;
}

function asString(value: unknown, where: string): string {
  if (typeof value !== 'string') fail(where, 'must be a string');
  return value;
}

function asStatus(value: unknown, where: string): ItemStatus {
  const status = asString(value, where);
  if (!(KNOWN_STATUSES as readonly string[]).includes(status)) {
    fail(where, `must be one of ${KNOWN_STATUSES.join(', ')}`);
  }
  return status as ItemStatus;
}

function parseCounts(value: unknown, where: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [key, count] of Object.entries(asObject(value, where))) {
    if (typeof count !== 'number' || !Number.isFinite(count)) {
      fail(`${where}.${key}`, 'must be a number');
    }
    counts[key] = count;
  }
  return counts;
}

function parseAudit(value: unknown, index: number): RawAudit {
  const where = `audits[${index}]`;
  const audit = asObject(value, where);
  return {
    id: asString(audit.id, `${where}.id`),
    title: asString(audit.title, `${where}.title`),
    doc: asString(audit.doc, `${where}.doc`),
    model: asString(audit.model, `${where}.model`),
    counts: parseCounts(audit.counts, `${where}.counts`),
    highlights: asArray(audit.highlights, `${where}.highlights`).map((entry, i) =>
      asString(entry, `${where}.highlights[${i}]`),
    ),
  };
}

function parseItem(value: unknown, where: string): RawItem {
  const item = asObject(value, where);
  return {
    task: item.task === undefined ? undefined : asString(item.task, `${where}.task`),
    ref: item.ref === undefined ? undefined : asString(item.ref, `${where}.ref`),
    title: asString(item.title, `${where}.title`),
    closes:
      item.closes === undefined
        ? undefined
        : asArray(item.closes, `${where}.closes`).map((entry, i) =>
            asString(entry, `${where}.closes[${i}]`),
          ),
    status: item.status === undefined ? undefined : asStatus(item.status, `${where}.status`),
  };
}

function parseWave(value: unknown, index: number): RawWave {
  const where = `waves[${index}]`;
  const wave = asObject(value, where);
  return {
    id: asString(wave.id, `${where}.id`),
    title: asString(wave.title, `${where}.title`),
    goal: asString(wave.goal, `${where}.goal`),
    items: asArray(wave.items, `${where}.items`).map((item, i) =>
      parseItem(item, `${where}.items[${i}]`),
    ),
  };
}

export function parsePlan(source: string): RawPlan {
  const data = asObject(JSON.parse(source), 'the root');
  return {
    title: asString(data.title, 'title'),
    updated: asString(data.updated, 'updated'),
    intro: asString(data.intro, 'intro'),
    audits: asArray(data.audits, 'audits').map(parseAudit),
    waves: asArray(data.waves, 'waves').map(parseWave),
  };
}

function readStatus(path: string): ItemStatus | null {
  let head: string;
  try {
    head = readFileSync(path, 'utf8').slice(0, 400);
  } catch {
    return null;
  }
  const match = /^status:\s*([a-z-]+)\s*$/m.exec(head);
  if (match === null) return null;
  const value = match[1] ?? '';
  return (KNOWN_STATUSES as readonly string[]).includes(value) ? (value as ItemStatus) : null;
}

export function taskStatuses(root: string): Map<string, TaskInfo> {
  const tasks = new Map<string, TaskInfo>();
  let names: string[];
  try {
    names = readdirSync(join(root, 'work'));
  } catch {
    return tasks;
  }
  for (const name of names) {
    const match = /^(T-\d+)-[^/]*\.md$/.exec(name);
    if (match === null) continue;
    const status = readStatus(join(root, 'work', name));
    if (status === null) continue;
    tasks.set(match[1] ?? '', { status, file: `work/${name}` });
  }
  return tasks;
}

/** The status of every task in work/BOARD.md, keyed by task id; a row whose cell
 * is not a known status is ignored. */
export function boardStatuses(root: string): Map<string, ItemStatus> {
  const board = new Map<string, ItemStatus>();
  let text: string;
  try {
    text = readFileSync(join(root, 'work/BOARD.md'), 'utf8');
  } catch {
    return board;
  }
  for (const line of text.split('\n')) {
    const link = /^\|\s*\[(T-\d+)\]\([^)]*\)\s*\|/.exec(line);
    if (link === null) continue;
    for (const cell of line.split('|').map((part) => part.trim())) {
      if ((KNOWN_STATUSES as readonly string[]).includes(cell)) {
        board.set(link[1] ?? '', cell as ItemStatus);
        break;
      }
    }
  }
  return board;
}

/** A plan.json status wins, then the task file, then the BOARD.md row. */
function buildItem(
  raw: RawItem,
  tasks: Map<string, TaskInfo>,
  board: Map<string, ItemStatus>,
): PlanItem {
  const info = raw.task === undefined ? undefined : tasks.get(raw.task);
  const onBoard = raw.task === undefined ? undefined : board.get(raw.task);
  let status: ItemStatus;
  if (raw.status !== undefined) status = raw.status;
  else if (raw.task === undefined) status = 'planned';
  else if (info?.status === 'todo' && (onBoard === 'in-progress' || onBoard === 'review')) {
    status = onBoard;
  } else {
    status = info?.status ?? onBoard ?? 'todo';
  }
  return {
    status,
    task: raw.task ?? null,
    ref: raw.ref ?? null,
    title: raw.title,
    closes: raw.closes ?? [],
    file: info?.file ?? null,
  };
}

export function buildPlan(
  plan: RawPlan,
  tasks: Map<string, TaskInfo>,
  board: Map<string, ItemStatus> = new Map(),
): PlanPage {
  const waves = plan.waves.map((wave) => {
    const items = wave.items.map((item) => buildItem(item, tasks, board));
    return {
      id: wave.id,
      title: wave.title,
      goal: wave.goal,
      items,
      merged: items.filter((item) => item.status === 'merged').length,
      total: items.length,
    };
  });
  const all = waves.flatMap((wave) => wave.items);
  return {
    title: plan.title,
    updated: plan.updated,
    intro: plan.intro,
    audits: plan.audits,
    waves,
    findings: [],
    parity: [],
    overall: { merged: all.filter((item) => item.status === 'merged').length, total: all.length },
  };
}

export function linkFindings(findings: Finding[], waves: PlanWave[]): PlanFinding[] {
  const fixedBy = new Map<string, { task: string; file: string }>();
  for (const wave of waves) {
    for (const item of wave.items) {
      if (item.status !== 'merged' || item.task === null || item.file === null) continue;
      for (const id of item.closes) {
        if (!fixedBy.has(id)) fixedBy.set(id, { task: item.task, file: item.file });
      }
    }
  }
  return findings.map((finding) => {
    const by = fixedBy.get(finding.id) ?? null;
    return { ...finding, fixed: by !== null, fixedBy: by };
  });
}

export function collectPlan(root: string = repoRoot()): PlanPage {
  const source = readFileSync(join(root, 'docs/plan/plan.json'), 'utf8');
  const plan = parsePlan(source);
  const page = buildPlan(plan, taskStatuses(root), boardStatuses(root));
  const sources: AuditSource[] = plan.audits.map((audit) => ({ id: audit.id, doc: audit.doc }));
  const findings = linkFindings(collectFindings(root, sources), page.waves);
  const parityAudit = plan.audits.find((audit) => audit.id === 'TG');
  const parity =
    parityAudit === undefined ? [] : parseParity(readFileSync(join(root, parityAudit.doc), 'utf8'));
  return { ...page, findings, parity };
}
