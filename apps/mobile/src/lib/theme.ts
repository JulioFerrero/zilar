import { DarkTheme, type Theme } from 'expo-router/react-navigation';

export const THEME = {
  dark: {
    background: '#0a0a0a',
    foreground: '#ededed',
    card: '#0a0a0a',
    cardForeground: '#ededed',
    popover: '#111111',
    popoverForeground: '#ededed',
    primary: '#ededed',
    primaryForeground: '#0a0a0a',
    secondary: '#111111',
    secondaryForeground: '#ededed',
    muted: '#111111',
    mutedForeground: '#a1a1a1',
    accent: '#ededed',
    accentForeground: '#0a0a0a',
    destructive: '#ef4444',
    border: '#1f1f1f',
    input: '#262626',
    ring: '#a1a1a1',
    radius: '0.75rem',
  },
};

export const NAV_THEME: Record<'dark', Theme> = {
  dark: {
    ...DarkTheme,
    colors: {
      background: THEME.dark.background,
      border: THEME.dark.border,
      card: THEME.dark.card,
      notification: THEME.dark.destructive,
      primary: THEME.dark.primary,
      text: THEME.dark.foreground,
    },
  },
};
