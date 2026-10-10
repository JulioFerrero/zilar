// Pure formatting helpers for `lead watch`, moved unchanged from
// `lead/watch.ts` (size split).

// `meta/muse-spark-1.3-contributor` + `low` → `muse-spark-1.3-contributor (low)`.
export function modelLabel(model: string, variant: string | undefined): string {
  const stripped = model.includes('/') ? model.slice(model.indexOf('/') + 1) : model;
  if (variant !== undefined && variant.length > 0) {
    return `${stripped} (${variant})`;
  }
  return stripped;
}

// `formatContext(158705) === '158k'`, `formatContext(1_234_000) === '1.2M'`.
// Numbers under 1k keep the full integer; numbers under 1M truncate to
// thousands (so `158_705 → 158k`, not `159k`); millions one-decimal.
export function formatContext(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) {
    return '0';
  }
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${trimmed(m)}M`;
  }
  if (tokens >= 1_000) {
    const k = Math.floor(tokens / 1_000);
    return `${k}k`;
  }
  return String(Math.round(tokens));
}

function trimmed(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (Number.isInteger(rounded)) {
    return `${rounded}`;
  }
  return rounded.toFixed(1);
}

// Sparkline of the last N values, scaled between the lowest and highest of
// those N (all equal: all `▄`). Oldest left, newest right.
const SPARK_BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const SPARK_EQUAL_BAR = '▄';

export function sparkline(values: number[]): string {
  if (values.length === 0) {
    return '';
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return SPARK_EQUAL_BAR.repeat(values.length);
  }
  return values
    .map((value) => {
      const ratio = (value - min) / (max - min);
      const idx = Math.min(
        SPARK_BARS.length - 1,
        Math.max(0, Math.round(ratio * (SPARK_BARS.length - 1))),
      );
      return SPARK_BARS[idx] ?? SPARK_EQUAL_BAR;
    })
    .join('');
}

// `1.5 s` or `1 min 5 s` when over 60 s. One decimal under a minute.
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0 s';
  }
  if (seconds < 60) {
    return `${trimmed(seconds)} s`;
  }
  const totalSec = Math.round(seconds);
  const minutes = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${minutes} min ${secs} s`;
}

export function formatClock(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
