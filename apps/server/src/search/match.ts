// Accent/case folding, prefix tsquery building and the in-code fuzzy pass. No
// database extension: the archive query stays bounded and fuzzy scoring runs in
// Node.
//
// `foldText` must produce the identical 1:1 mapping as the SQL
// `translate(lower(txt), FOLD_FROM, FOLD_TO)`; characters outside the map stay
// unfolded on both sides and still match exactly.

export interface WordSpan {
  word: string;
  /** Code-point offsets into the source text (same unit as snippet marks). */
  start: number;
  end: number;
}

export interface MarkedSnippet {
  snippet: string;
  marks: Array<[number, number]>;
}

const LOWER_FROM = 'àáâãäåçèéêëìíîïñòóôõöøùúûüýÿ';
const LOWER_TO = 'aaaaaaceeeeiiiinoooooouuuuyy';
const UPPER_FROM = 'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝŸ';
const UPPER_TO = 'AAAAAACEEEEIIIINOOOOOOUUUUYY';

/** translate() pair for the SQL side; passed as bindings, never interpolated. */
export const FOLD_FROM = LOWER_FROM + UPPER_FROM;
export const FOLD_TO = LOWER_TO + UPPER_TO;

const foldMap = new Map<string, string>();
for (let i = 0; i < FOLD_FROM.length; i += 1) {
  foldMap.set(FOLD_FROM[i] ?? '', FOLD_TO[i] ?? '');
}

export function foldText(value: string): string {
  const lowered = value.toLowerCase();
  let out = '';
  for (const char of lowered) {
    out += foldMap.get(char) ?? char;
  }
  return out;
}

// Folded lowercase words from `[\p{L}\p{N}]+`, so a token can never contain
// tsquery syntax. Operators or punctuation alone yield no tokens.
export function searchTerms(query: string): string[] {
  return foldText(query).match(/[\p{L}\p{N}]+/gu) ?? [];
}

// Earlier terms stay whole words; the LAST term matches as a prefix.
export function buildTsQuery(terms: string[]): string {
  return terms
    .map((term, index) => `"${term}"${index === terms.length - 1 ? ':*' : ''}`)
    .join(' & ');
}

// Code-point offsets: the marks unit counts code points, so a UTF-16 index would
// drift on emoji.
export function splitWords(text: string): WordSpan[] {
  const spans: WordSpan[] = [];
  const pattern = /[\p{L}\p{N}]+/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const start = Array.from(text.slice(0, match.index)).length;
    spans.push({ word: match[0], start, end: start + [...match[0]].length });
  }
  return spans;
}

// Damerau-Levenshtein (optimal string alignment: an adjacent transposition is one
// edit) with an early exit past `cap`.
export function damerauDistance(a: string, b: string, cap: number): number {
  const s = [...a];
  const t = [...b];
  const n = s.length;
  const m = t.length;
  if (Math.abs(n - m) > cap) {
    return cap + 1;
  }
  if (n === 0) {
    return m;
  }
  if (m === 0) {
    return n;
  }
  let beforePrev: number[] = Array.from({ length: m + 1 }, () => 0);
  let prev: number[] = Array.from({ length: m + 1 }, (_, j) => j);
  let curr: number[] = Array.from({ length: m + 1 }, () => 0);
  for (let i = 1; i <= n; i += 1) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= m; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let best = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        best = Math.min(best, beforePrev[j - 2]! + 1);
      }
      curr[j] = best;
      if (best < rowMin) {
        rowMin = best;
      }
    }
    if (rowMin > cap) {
      return cap + 1;
    }
    const tmp = beforePrev;
    beforePrev = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[m]!;
}

// Exact mode: earlier terms are whole words and the last matches by prefix, the
// same rule the tsquery encodes. Fuzzy mode: 1-3 characters match exactly or by
// prefix, 4-7 allow distance 1, 8+ distance 2, and the last term also by prefix.
export function matchMessageTerms(
  terms: string[],
  text: string,
  fuzzy: boolean,
): WordSpan[] | null {
  if (terms.length === 0) {
    return null;
  }
  const words = splitWords(text);
  const folded = words.map((span) => foldText(span.word));
  const matched: WordSpan[] = [];
  for (let i = 0; i < terms.length; i += 1) {
    const term = terms[i]!;
    const last = i === terms.length - 1;
    const allowed = term.length <= 7 ? 1 : 2;
    let hit = -1;
    for (let k = 0; k < words.length; k += 1) {
      const word = folded[k]!;
      if (word === term || (last && word.startsWith(term))) {
        hit = k;
        break;
      }
      if (!fuzzy) {
        continue;
      }
      // Short terms never go fuzzy: exact or prefix only, at any position.
      if (term.length <= 3) {
        if (word.startsWith(term)) {
          hit = k;
          break;
        }
        continue;
      }
      if (damerauDistance(term, word, allowed) <= allowed) {
        hit = k;
        break;
      }
    }
    if (hit === -1) {
      return null;
    }
    matched.push(words[hit]!);
  }
  return matched;
}

// Sorted, merged and clamped into [0, max], in code points so emoji stay aligned.
export function mergeMarks(marks: Array<[number, number]>, max: number): Array<[number, number]> {
  const sorted = [...marks].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const [rawStart, rawEnd] of sorted) {
    const start = Math.max(0, Math.min(rawStart, max));
    const end = Math.max(0, Math.min(rawEnd, max));
    if (end <= start) {
      continue;
    }
    const last = merged[merged.length - 1];
    if (last !== undefined && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

// A window around the first matched word, with spans shifted into it: plain text
// plus marks, never HTML.
export function windowSnippet(
  text: string,
  spans: WordSpan[],
  before = 40,
  maxLength = 200,
): MarkedSnippet {
  const chars = [...text];
  const first = spans[0]?.start ?? 0;
  const start = Math.max(0, first - before);
  const snippet = chars.slice(start, start + maxLength).join('');
  const length = [...snippet].length;
  return {
    snippet,
    marks: mergeMarks(
      spans.map((span) => [span.start - start, span.end - start] as [number, number]),
      length,
    ),
  };
}
