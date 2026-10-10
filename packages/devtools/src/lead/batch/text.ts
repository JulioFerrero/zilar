export const WAVE_BRANCH = 'wave';
export const MESSAGE_LINES = 30;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

export function firstLines(text: string, count: number): string {
  return stripAnsi(text).split('\n').slice(0, count).join('\n').trimEnd();
}

export function lastLines(text: string, count: number): string {
  return stripAnsi(text).trimEnd().split('\n').slice(-count).join('\n');
}

export function lines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_');
}
