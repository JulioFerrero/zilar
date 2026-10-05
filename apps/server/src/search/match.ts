// Smarter search matching (T-0142): accent/case folding, prefix tsquery
// building, and the in-code fuzzy second pass. No database extension is
// used: the archive query stays bounded (own scope, 12-month cutoff, at most
// SEARCH_MAX_CANDIDATES rows) and fuzzy scoring runs here in Node.
//
// Folding parity: the SQL side folds with
// `translate(lower(txt), FOLD_FROM, FOLD_TO)` (see buildArchiveQuery) and
// `foldText` below must produce the identical mapping. Both are 1:1
// character maps over the same pair, applied after lowercasing, so accented
// capitals fold the same way on both sides. Characters outside the map
// (æ, œ, ß, ð, …) are left unfolded on both sides: they still match exactly.

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

// Query tokens: folded lowercase words. Anything that is only
// operators/punctuation yields no tokens (the route answers an empty list).
// Tokens come from [\p{L}\p{N}]+, so they can never contain tsquery syntax
// and are safe to quote into a tsquery string passed as a binding.
export function searchTerms(query: string): string[] {
  return foldText(query).match(/[\p{L}\p{N}]+/gu) ?? [];
}

// Earlier terms stay whole words; the LAST term matches as a prefix.
export function buildTsQuery(terms: string[]): string {
  return terms
    .map((term, index) => `"${term}"${index === terms.length - 1 ? ':*' : ''}`)
    .join(' & ');
}

// Words with code-point offsets (the marks unit: headlineToSnippet counts
// [...snippet].length, so a UTF-16 index would drift on emoji).
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

// Damerau-Levenshtein (optimal string alignment: one adjacent transposition
// counts as one edit) with an early exit past `cap`. Inputs are short
// (folded words), so the full matrix is cheap.
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

// One matched span per query term, or null when a term has no match.
// Exact mode (the first pass): earlier terms are whole words, the last term
// also matches by prefix — the same rule the tsquery encodes, used to add
// in-code marks for hits ts_headline cannot mark (accent-folded words).
// Fuzzy mode (the second pass): terms of 1-3 characters match exactly or by
// prefix only (never by distance); terms of 4-7 allow distance 1, 8+ allow
// distance 2; the last term additionally matches by prefix at any length.
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

// Sorted, merged, clamped into [0, max]: out-of-range offsets are impossible
// by construction, and emoji/multi-byte text stays aligned (code points).
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

// Plain-text snippet for fuzzy hits: a window around the first matched word
// with the matched spans shifted into it (same wire shape as ts_headline
// hits: plain text plus marks, never HTML).
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
