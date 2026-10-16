// The chart math shared by the web and phone block renderers (05 bars, 06 line,
// 07 gauge). It follows `docs/design/mockups/blocks/WebNumbers.dc.html`; keeping
// it here means the phone twin draws the same shapes from the same numbers. Plain
// numbers only, no React.

// Rounds a coordinate to one decimal, the precision the board's paths use.
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

// The compact units, largest first, with the threshold at which each applies.
const COMPACT_UNITS: readonly { readonly limit: number; readonly suffix: string }[] = [
  { limit: 1e9, suffix: 'B' },
  { limit: 1e6, suffix: 'M' },
  { limit: 1e3, suffix: 'k' },
];

// Shortens a raw axis number the way the board labels its bounds (`79.1k`, `82.3k`,
// `WebNumbers.dc.html:80-81`): one decimal, no trailing `.0`, the sign kept. Below a
// thousand the number is shown as it is.
export function compactNumber(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  for (const unit of COMPACT_UNITS) {
    if (abs >= unit.limit) return `${sign}${round(abs / unit.limit)}${unit.suffix}`;
  }
  return `${value}`;
}

// Scales a series' values to bar heights; the tallest bar reaches `maxHeight` in
// the caller's unit (the board draws its peak at 87% of a 120 px track, `:154-161`).
// A peak of zero (or below) gives every bar zero height, so an all-zero series
// never divides by zero, and a negative value clamps to zero height too (its label
// still shows the real number).
export function barHeights(
  series: readonly { readonly value: number }[],
  maxHeight: number,
): number[] {
  const peak = Math.max(...series.map((entry) => entry.value), 0);
  if (peak === 0) return series.map(() => 0);
  return series.map((entry) => (entry.value <= 0 ? 0 : (entry.value / peak) * maxHeight));
}

// Builds the SVG `d` of a line scaled into a `width`×`height` box. Unlike a
// sparkline it honours optional `min`/`max` bounds, so the axis can be wider than
// the data; points outside the bounds are clamped to the box. The coordinate
// rounding matches `sparklinePath`, and a flat line sits on the mid-line.
export function linePath(
  points: readonly number[],
  width: number,
  height: number,
  min?: number,
  max?: number,
): string {
  if (points.length < 2) return '';
  const low = min ?? Math.min(...points);
  const high = max ?? Math.max(...points);
  const span = high - low;
  return points
    .map((point, index) => {
      const x = (width * index) / (points.length - 1);
      const scaled = span === 0 ? 0.5 : 1 - (point - low) / span;
      const y = Math.min(1, Math.max(0, scaled)) * height;
      return `${index === 0 ? 'M' : 'L'} ${round(x)} ${round(y)}`;
    })
    .join(' ');
}

// Builds the SVG `d` of the gauge's value sweep: an arc drawn clockwise from 12
// o'clock (the board's `rotate(-90 40 40)` dash, `:96`). The path is centred on
// the origin, so a renderer wraps it in a `translate(cx cy)`; a ratio of 1 is a
// full ring, drawn as two half arcs, and the ratio is clamped to 0–1.
export function gaugeArc(ratio: number, radius: number): string {
  const clamped = Math.min(1, Math.max(0, ratio));
  const top = round(-radius);
  if (clamped === 0) return `M 0 ${top}`;
  if (clamped === 1) {
    const bottom = round(radius);
    return `M 0 ${top} A ${radius} ${radius} 0 1 1 0 ${bottom} A ${radius} ${radius} 0 1 1 0 ${top}`;
  }
  const angle = clamped * Math.PI * 2 - Math.PI / 2;
  const x = round(radius * Math.cos(angle));
  const y = round(radius * Math.sin(angle));
  const largeArc = clamped > 0.5 ? 1 : 0;
  return `M 0 ${top} A ${radius} ${radius} 0 ${largeArc} 1 ${x} ${y}`;
}
