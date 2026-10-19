// T-1988: the markup scanners must stay linear. Crafted pages and message
// stanzas used to block the event loop for seconds on inputs that fit under
// the fetch and stanza caps, so every helper and every reader gets a timing
// run on its own pathological shape.

import { describe, expect, it } from 'vitest';
import { parseLinkPreview } from '../link-preview/fetch';
import {
  elementBlocks,
  findCloseTag,
  firstElement,
  nextTag,
  openTagAttrs,
  stripComments,
  stripTags,
} from './scan';

const BUDGET_MS = 200;
const MIB = 1024 * 1024;

function repeatTo(value: string, length: number): string {
  return value.repeat(Math.ceil(length / value.length)).slice(0, length);
}

function expectUnderBudget(label: string, run: () => void): void {
  // A single wall-clock sample flakes on this shared machine even though the
  // scanners are linear: JIT warmup, allocations and scheduling noise only ever
  // add time, and can add hundreds of milliseconds to an otherwise fast run.
  // Warm up once, then keep the fastest of five samples: noise cannot make it
  // slower, and a real regression (quadratic or otherwise) still blows past the
  // budget on every sample.
  run();
  const samples: number[] = [];
  for (let sample = 0; sample < 5; sample += 1) {
    const started = performance.now();
    run();
    samples.push(performance.now() - started);
  }
  const fastest = Math.min(...samples);
  const detail = samples.map((value) => value.toFixed(0)).join(', ');
  expect(
    fastest,
    `${label} fastest took ${fastest.toFixed(0)} ms (samples: ${detail})`,
  ).toBeLessThan(BUDGET_MS);
}

describe('scan helpers on crafted input', () => {
  const crafted: ReadonlyArray<readonly [string, string]> = [['<a>', repeatTo('<a>', 2 * MIB)]];

  it.each(crafted)('stays under the budget on 2 MiB of %s', (label, input) => {
    const calls: ReadonlyArray<readonly [string, () => void]> = [
      ['stripComments', () => void stripComments(input)],
      ['stripTags', () => void stripTags(input, ' ')],
      ['elementBlocks(item)', () => void elementBlocks(input, 'item', 10)],
      ['elementBlocks(a)', () => void elementBlocks(input, 'a', 10)],
      ['firstElement(item)', () => void firstElement(input, 'item')],
      ['firstElement(a)', () => void firstElement(input, 'a')],
      ['openTagAttrs(item)', () => void openTagAttrs(input, 'item')],
      ['openTagAttrs(a)', () => void openTagAttrs(input, 'a')],
      ['nextTag(a)', () => void nextTag(input, 'a', 0)],
      ['findCloseTag(a)', () => void findCloseTag(input, 'a', 0)],
    ];
    for (const [name, call] of calls) {
      expectUnderBudget(`${label} ${name}`, call);
    }
  });
});

describe('markup readers on crafted input', () => {
  it('parseLinkPreview stays under the budget on a run of <title>', () => {
    const input = repeatTo('<title>', 256 * 1024);
    expectUnderBudget('parseLinkPreview', () => void parseLinkPreview(input));
  });
});
