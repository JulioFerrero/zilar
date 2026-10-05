export type ColorScheme = 'light' | 'dark';

export function asColorScheme(value: string | null | undefined): ColorScheme {
  return value === 'dark' ? 'dark' : 'light';
}
