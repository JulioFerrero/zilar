// The fixed glyph set web and phone draw for a weather condition, keyed by the
// lucide name both platforms share. The AI sends the condition as free text, so
// `weatherIcon` is the one place that decides which picture it maps to.
export type WeatherIconKey = 'sun' | 'cloud' | 'rain' | 'storm' | 'snow' | 'fog' | 'wind';

// Condition keywords, longest first so "thunderstorm" reads as a storm rather
// than as rain, and "shower" before the bare "rain".
const WEATHER_ICONS: readonly (readonly [string, WeatherIconKey])[] = [
  ['thunder', 'storm'],
  ['storm', 'storm'],
  ['snow', 'snow'],
  ['sleet', 'snow'],
  ['shower', 'rain'],
  ['drizzle', 'rain'],
  ['rain', 'rain'],
  ['fog', 'fog'],
  ['mist', 'fog'],
  ['haze', 'fog'],
  ['wind', 'wind'],
  ['clear', 'sun'],
  ['sun', 'sun'],
  ['cloud', 'cloud'],
  ['overcast', 'cloud'],
];

/**
 * Maps a free-text weather condition to one fixed glyph key. Matching is
 * case-insensitive and substring-based, so "Partly cloudy" reads as cloud and
 * "Heavy rain" as rain; anything unrecognised reads as the neutral cloud.
 */
export function weatherIcon(condition: string): WeatherIconKey {
  const text = condition.toLowerCase();
  for (const [keyword, key] of WEATHER_ICONS) {
    if (text.includes(keyword)) return key;
  }
  return 'cloud';
}

// The event date tile and its when line, already rendered in the viewer's zone.
export type EventWhen = {
  /** The tile's month, e.g. `OCT`. */
  month: string;
  /** The tile's day, e.g. `17`. */
  day: string;
  /** The when line, e.g. `Fri 21:00 – 23:00` or a dated range across days. */
  line: string;
};

/**
 * Formats an event for the board's date tile and when line
 * (`WebContent.dc.html:166-172`) in `timeZone`, the viewer's own zone. A
 * same-day event shows the weekday and the time range; an event that ends on
 * another day shows both dates so the range stays unambiguous. Built from
 * `Intl.DateTimeFormat`, which browsers and Hermes both ship.
 */
export function eventWhen(startAt: string, endAt: string, timeZone: string): EventWhen {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const format = (options: Intl.DateTimeFormatOptions, date: Date): string =>
    new Intl.DateTimeFormat('en', { ...options, timeZone }).format(date);
  const dateKey = (date: Date): string =>
    format({ year: 'numeric', month: '2-digit', day: '2-digit' }, date);
  const time = (date: Date): string =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(date);
  const month = format({ month: 'short' }, start).toUpperCase();
  const day = format({ day: 'numeric' }, start);
  const line =
    dateKey(start) === dateKey(end)
      ? `${format({ weekday: 'short' }, start)} ${time(start)} – ${time(end)}`
      : `${format({ weekday: 'short', day: 'numeric', month: 'short' }, start)} ` +
        `${time(start)} – ${format({ weekday: 'short', day: 'numeric', month: 'short' }, end)} ` +
        `${time(end)}`;
  return { month, day, line };
}
