import { ScrollTrigger } from '@/lib/gsap';
import { SECTION, TRIGGER } from '@/lib/sections';

// Where the mark sits for a scroll position. `cx`/`cy` are the centre of the whole mark as a
// fraction of the viewport's half-width and half-height (−1..1, up is positive), `size` is the
// orbit's diameter as a fraction of the viewport height, and `o` is the canvas opacity.
export type Station = {
  at: number;
  cx: number;
  cy: number;
  size: number;
  o: number;
};

type Row = readonly [cx: number, cy: number, size: number, o: number];

// The stations, in scroll order: page top, hero end, statement middle, story start, story end,
// keys middle, computer start, computer end − 0.2 viewport, details start + 15%, details end,
// install middle, page end.
const WIDE: readonly Row[] = [
  [0.5, 0.02, 0.62, 1],
  [0.04, 0, 1.19, 1],
  [0.6, 0.25, 0.61, 0.4],
  [0.39, -0.04, 0.94, 0.55],
  [0.39, -0.04, 0.94, 0.55],
  [-0.57, 0.14, 0.65, 0.6],
  [-0.57, 0.14, 0.65, 0],
  [0, -1.16, 2.24, 0],
  [0, -1.16, 2.24, 1],
  [-0.18, -1.13, 2.24, 1],
  [0.53, 0.14, 0.58, 0.35],
  [0, 0.19, 0.69, 1],
];

const NARROW: readonly Row[] = [
  [0, 0.44, 0.4, 1],
  [0, 0.12, 0.69, 1],
  [0.53, 0.6, 0.33, 0.4],
  [0, 0.04, 0.61, 0.55],
  [0, 0.04, 0.61, 0.55],
  [0, 0.49, 0.36, 0.6],
  [0, 0.49, 0.36, 0],
  [0, -0.92, 1.37, 0],
  [0, -0.92, 1.37, 1],
  [0, -0.88, 1.37, 1],
  [0.46, 0.67, 0.33, 0.35],
  [0, 0.35, 0.45, 1],
];

// Phones get the narrow layout, the same breakpoint the scene uses.
const NARROW_ASPECT = 0.85;

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

function rowToStation(at: number, row: Row): Station {
  return { at, cx: row[0], cy: row[1], size: row[2], o: row[3] };
}

function interpolate(rows: readonly Station[], y: number): Station {
  const first = rows[0];
  if (first === undefined) return { at: y, cx: 0, cy: 0, size: 0.7, o: 0 };
  if (y <= first.at) return first;
  for (let index = 0; index < rows.length - 1; index++) {
    const a = rows[index];
    const b = rows[index + 1];
    if (a === undefined || b === undefined) break;
    if (y <= b.at) {
      const t = b.at > a.at ? smoothstep((y - a.at) / (b.at - a.at)) : 1;
      return {
        at: y,
        cx: a.cx + (b.cx - a.cx) * t,
        cy: a.cy + (b.cy - a.cy) * t,
        size: a.size + (b.size - a.size) * t,
        o: a.o + (b.o - a.o) * t,
      };
    }
  }
  return rows[rows.length - 1] ?? first;
}

// The scroll positions come from ScrollTrigger: the pinned sections expose `start`/`end` by id,
// and statement, keys and install use their element's `top bottom` → `bottom top` span. Until
// those pins exist the mark holds the page-top station.
export function createStations(): (y: number, aspect: number) => Station {
  const span = (id: string): ScrollTrigger =>
    ScrollTrigger.create({ trigger: `#${id}`, start: 'top bottom', end: 'bottom top' });
  const statement = span(SECTION.statement);
  const keys = span(SECTION.keys);
  const install = span(SECTION.install);

  return (y: number, aspect: number): Station => {
    const table = aspect < NARROW_ASPECT ? NARROW : WIDE;
    const hero = ScrollTrigger.getById(TRIGGER.hero);
    const story = ScrollTrigger.getById(TRIGGER.story);
    const computer = ScrollTrigger.getById(TRIGGER.computer);
    const details = ScrollTrigger.getById(TRIGGER.details);
    if (
      hero === undefined ||
      story === undefined ||
      computer === undefined ||
      details === undefined
    ) {
      const first = table[0];
      return first === undefined ? interpolate([], y) : rowToStation(0, first);
    }
    const height = window.innerHeight;
    const at = [
      0,
      hero.end,
      (statement.start + statement.end) / 2,
      story.start,
      story.end,
      (keys.start + keys.end) / 2,
      computer.start,
      computer.end - height * 0.2,
      details.start + (details.end - details.start) * 0.15,
      details.end,
      (install.start + install.end) / 2,
      ScrollTrigger.maxScroll(window),
    ];
    const rows = table.map((row, index) => rowToStation(at[index] ?? 0, row));
    return interpolate(rows, y);
  };
}
