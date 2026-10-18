// The AI sends the condition as free text, so `weatherIcon` is the one place that decides which glyph it maps to.
export type WeatherIconKey = 'sun' | 'cloud' | 'rain' | 'storm' | 'snow' | 'fog' | 'wind';

// Longest first so "thunderstorm" reads as a storm rather than rain, and "shower" before the bare "rain".
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

export function weatherIcon(condition: string): WeatherIconKey {
  const text = condition.toLowerCase();
  for (const [keyword, key] of WEATHER_ICONS) {
    if (text.includes(keyword)) return key;
  }
  return 'cloud';
}

export type EventWhen = {
  month: string;
  day: string;
  line: string;
};

// A same-day event shows the weekday and time range; one that ends another day shows both dates. Built from `Intl.DateTimeFormat`, which browsers and Hermes both ship.
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
