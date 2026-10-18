// Parses the Telegram parity matrix (section 2 of docs/audit/telegram-parity-audit.md)
// into one row per feature. Only tables whose header names the four parity columns are
// read, so the fix-plan and summary tables are ignored.
export interface ParityRow {
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
