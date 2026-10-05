import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { AisScreenShell } from '@/components/ais/screen-shell';

import { SettingsScreenShell } from './screen-shell';

// The shells render as plain elements with `react-native`,
// `react-native-safe-area-context` and `lucide-react-native` stubbed (the
// `settings-ui.test.tsx` pattern): Node only, no simulator, no new dependency.
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft',
}));

vi.mock('@/components/ui/icon-button', () => ({
  IconButton: 'IconButton',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

const SHELLS = ['settings', 'ais'] as const;

function renderHeader(shell: (typeof SHELLS)[number], onBack?: () => void): string {
  return renderToStaticMarkup(
    shell === 'settings' ? (
      <SettingsScreenShell title="Settings" onBack={onBack}>
        body
      </SettingsScreenShell>
    ) : (
      <AisScreenShell title="Settings" onBack={onBack}>
        body
      </AisScreenShell>
    ),
  );
}

describe('screen shells header padding', () => {
  it('insets the title row by 16 when there is no back key', () => {
    for (const shell of SHELLS) {
      const html = renderHeader(shell);
      expect(html).toContain('px-4');
      expect(html).not.toContain('px-2');
    }
  });

  it('keeps the 8 px inset when the back key brings its own spacing', () => {
    for (const shell of SHELLS) {
      const html = renderHeader(shell, () => {});
      expect(html).toContain('px-2');
      expect(html).not.toContain('px-4');
    }
  });
});
