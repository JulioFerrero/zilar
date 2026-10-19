// Parses the audit docs under docs/audit/ into one finding per PREFIX-N token. The
// docs use a bullet, a bold paragraph and a summary table; a table or bullet list
// covers only part of its doc, and a finding with no severity becomes "Unrated".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Severity = 'P0' | 'P1' | 'P2' | 'P3' | 'Unrated';

export interface Finding {
  id: string;
  audit: string;
  severity: Severity;
  platform: string | null;
  title: string;
}

export interface AuditSource {
  id: string;
  doc: string;
}

/** The shape of one doc occurrence; the highest rank wins the title. */
type Rank = 3 | 2 | 1 | 0;

interface Entry {
  id: string;
  severity: Severity | null;
  platform: string | null;
  title: string;
  rank: Rank;
}

const SEVERITY = /\bP[0-3]\b/;
const PLATFORM = /\b(web\+mobile|both|mobile|web|server)\b/;
const MAX_TITLE = 140;
// The two client UX audits are single-platform, so their docs do not repeat the
// platform on every finding; every entry of them is on this one.
const AUDIT_PLATFORM: Record<string, string> = { MUX: 'mobile', WUX: 'web' };

function severityOf(text: string): Severity | null {
  const match = SEVERITY.exec(text);
  return match === null ? null : (match[0] as Severity);
}

function platformOf(text: string): string | null {
  const match = PLATFORM.exec(text);
  return match === null ? null : (match[1] ?? null);
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstSentence(text: string): string {
  const match = /^.*?[.!?](?=\s+[A-Z(]|\s*$)/.exec(text);
  return match === null ? text : match[0];
}

function titleOf(text: string): string {
  const sentence = firstSentence(stripMarkdown(text));
  if (sentence.length <= MAX_TITLE) return sentence;
  return `${sentence.slice(0, MAX_TITLE - 1).trimEnd()}…`;
}

function metaEnd(text: string): number {
  const match = /\.\s+|\)\s*[:—–]\s*|\)\s+/.exec(text);
  return match === null ? text.length : match.index + match[0].length;
}

function parseBullets(lines: string[], prefix: string): Entry[] {
  const out: Entry[] = [];
  const start = new RegExp(`^-\\s+(${prefix}-\\d+)\\s+(P[0-3])\\b(.*)$`);
  for (let i = 0; i < lines.length; i += 1) {
    const match = start.exec(lines[i] ?? '');
    if (match === null) continue;
    let tail = match[3] ?? '';
    let next = i + 1;
    while (next < lines.length) {
      const line = (lines[next] ?? '').trim();
      if (line === '' || /^[-#|*>]/.test(line)) break;
      tail += ` ${line}`;
      next += 1;
    }
    const colon = tail.indexOf(':');
    const meta = colon === -1 ? tail : tail.slice(0, colon);
    const text = colon === -1 ? '' : tail.slice(colon + 1);
    out.push({
      id: match[1] ?? '',
      severity: (match[2] as Severity | undefined) ?? null,
      platform: platformOf(meta),
      title: titleOf(text),
      rank: 3,
    });
    i = next - 1;
  }
  return out;
}

function parseBold(lines: string[], prefix: string): Entry[] {
  const out: Entry[] = [];
  const start = new RegExp(`^\\*\\*(${prefix}-\\d+)\\b(.*)$`);
  for (let i = 0; i < lines.length; i += 1) {
    const match = start.exec((lines[i] ?? '').trim());
    if (match === null) continue;
    let inner = match[2] ?? '';
    let after = '';
    const close = inner.indexOf('**');
    if (close !== -1) {
      after = inner.slice(close + 2);
      inner = inner.slice(0, close);
    }
    let next = i + 1;
    while (next < lines.length) {
      const line = (lines[next] ?? '').trim();
      if (line === '' || line.startsWith('**') || line.startsWith('#') || line.startsWith('|')) {
        break;
      }
      after += ` ${line}`;
      next += 1;
    }
    const combined = `${inner} ${after}`.replace(/\s+/g, ' ').trim();
    const cut = metaEnd(combined);
    const meta = combined.slice(0, cut);
    out.push({
      id: match[1] ?? '',
      severity: severityOf(meta),
      platform: platformOf(meta),
      title: titleOf(combined.slice(cut)),
      rank: 1,
    });
    i = next - 1;
  }
  return out;
}

export function splitRow(line: string): string[] {
  const body = line.replace(/^\|/, '').replace(/\|$/, '');
  return body.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
}

function parseTables(lines: string[], prefix: string): Entry[] {
  const out: Entry[] = [];
  const isId = new RegExp(`^${prefix}-\\d+$`);
  const isTitle = /one line|finding|what the user feels/i;
  let platformIndex: number | null = null;
  let titleIndex = 0;
  let columns = 0;
  let inTable = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('|')) {
      inTable = false;
      continue;
    }
    const cells = splitRow(line);
    if (cells.length >= 3 && /^id$/i.test(cells[0] ?? '') && /^sev/i.test(cells[1] ?? '')) {
      const platform = cells.findIndex((cell) => /^platform$/i.test(cell));
      const title = cells.findIndex((cell) => isTitle.test(cell));
      platformIndex = platform === -1 ? null : platform;
      titleIndex = title === -1 ? cells.length - 1 : title;
      columns = cells.length;
      inTable = true;
      continue;
    }
    if (!inTable || cells.length !== columns) continue;
    const id = cells[0] ?? '';
    if (!isId.test(id)) continue;
    const severity = severityOf(cells[1] ?? '');
    if (severity === null) continue;
    out.push({
      id,
      severity,
      platform: platformIndex === null ? null : (cells[platformIndex] ?? null),
      title: titleOf(cells[titleIndex] ?? ''),
      rank: 2,
    });
  }
  return out;
}

function parseInline(lines: string[], prefix: string): Entry[] {
  const out: Entry[] = [];
  const seen = new Set<string>();
  const token = new RegExp(`\\b${prefix}-\\d+\\b`, 'g');
  for (const raw of lines) {
    const matches = raw.match(token);
    if (matches === null) continue;
    for (const id of matches) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        severity: severityOf(raw),
        platform: platformOf(raw),
        title: titleOf(raw.replace(token, ' ')),
        rank: 0,
      });
    }
  }
  return out;
}

function firstOf<T>(values: (T | null)[]): T | null {
  for (const value of values) {
    if (value !== null) return value;
  }
  return null;
}

function suffix(id: string): number {
  return Number(id.split('-')[1] ?? 0);
}

function merge(entries: Entry[]): Finding[] {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.id);
    if (list === undefined) groups.set(entry.id, [entry]);
    else list.push(entry);
  }
  const findings: Finding[] = [];
  for (const [id, list] of groups) {
    const structured = list.filter((entry) => entry.rank > 0);
    const ranked = [...(structured.length > 0 ? structured : list)].sort((a, b) => b.rank - a.rank);
    const severity = firstOf(ranked.map((entry) => entry.severity)) ?? 'Unrated';
    const found = firstOf(ranked.map((entry) => entry.platform));
    const platform = found ?? AUDIT_PLATFORM[id.split('-')[0] ?? ''] ?? null;
    let title = '';
    for (const entry of ranked) {
      if (entry.title !== '') {
        title = entry.title;
        break;
      }
    }
    findings.push({ id, audit: id.split('-')[0] ?? id, severity, platform, title });
  }
  return findings.sort((a, b) => suffix(a.id) - suffix(b.id));
}

export function parseAuditDoc(audit: string, source: string): Finding[] {
  const lines = source.split('\n');
  return merge([
    ...parseBullets(lines, audit),
    ...parseTables(lines, audit),
    ...parseBold(lines, audit),
    ...parseInline(lines, audit),
  ]);
}

export function collectFindings(root: string, audits: readonly AuditSource[]): Finding[] {
  const out: Finding[] = [];
  for (const audit of audits) {
    let source: string;
    try {
      source = readFileSync(join(root, audit.doc), 'utf8');
    } catch {
      continue;
    }
    out.push(...parseAuditDoc(audit.id, source));
  }
  return out;
}
