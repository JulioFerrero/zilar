const { hairlineWidth } = require('nativewind/theme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        edge: 'var(--edge)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        page: 'var(--page)',
        panel: 'var(--panel)',
        surface: 'var(--surface)',
        'surface-raised': 'var(--surface-raised)',
        well: 'var(--well)',
        'subtle-foreground': 'var(--subtle-foreground)',
        'generating-foreground': 'var(--generating-foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        'chat-background': 'var(--chat-background)',
        'bubble-in': 'var(--bubble-in)',
        'bubble-out': 'var(--bubble-out)',
        'bubble-in-meta': 'var(--bubble-in-meta)',
        'bubble-out-meta': 'var(--bubble-out-meta)',
        'list-hover': 'var(--list-hover)',
        'list-active': 'var(--list-active)',
        'badge-muted': 'var(--badge-muted)',
        divider: 'var(--divider)',
        danger: 'var(--danger)',
        online: 'var(--online)',
      },
      /*
       * React Native has no style inheritance, and each bundled font weight is
       * its own family. The keys below give the core weight classes
       * (`font-medium`, `font-semibold`, `font-bold`) a Geist family to point
       * at; `font-sans` and `font-mono` cover the rest.
       */
      fontFamily: {
        sans: ['Geist_400Regular'],
        medium: ['Geist_500Medium'],
        semibold: ['Geist_600SemiBold'],
        bold: ['Geist_600SemiBold'],
        mono: ['GeistMono_400Regular'],
        'mono-medium': ['GeistMono_500Medium'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      borderWidth: {
        hairline: hairlineWidth(),
      },
    },
  },
  future: {
    hoverOnlyWhenSupported: true,
  },
  plugins: [require('tailwindcss-animate')],
};
