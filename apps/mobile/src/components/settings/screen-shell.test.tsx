import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AisScreenShell } from '@/components/ais/screen-shell';
import { tabScreenBottomPadding } from '@/components/nav/floating-tab-bar';

import { SettingsScreenShell } from './screen-shell';

const insets = vi.hoisted(() => ({ top: 0, bottom: 0, left: 0, right: 0 }));

// The shells render as plain elements with `react-native`,
// `react-native-safe-area-context` and `lucide-react-native` stubbed (the
// `settings-ui.test.tsx` pattern): Node only, no simulator, no new dependency.
vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: (props: { children?: unknown; contentContainerStyle?: { paddingBottom?: number } }) =>
    createElement(
      'div',
      { 'data-padding-bottom': String(props.contentContainerStyle?.paddingBottom) },
      props.children as never,
    ),
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => insets,
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

// The shells now import `floating-tab-bar` for the tab-screen padding helper,
// so its heavier seams are stubbed here too (the `floating-tab-bar.test.tsx`
// pattern) to keep this a Node-only render.
vi.mock('expo-router/ui', () => ({
  TabTrigger: 'TabTrigger',
  useTabTrigger: () => ({ trigger: undefined, triggerProps: {} }),
}));

vi.mock('@zilar/chat-core', () => ({
  initials: () => 'AL',
}));

vi.mock('@/lib/auth', () => ({
  API_URL: 'https://api.example',
}));

vi.mock('@/components/settings/profile-logic', () => ({
  avatarImageSource: () => ({}),
}));

const SHELLS = ['settings', 'ais'] as const;

beforeEach(() => {
  insets.top = 0;
  insets.bottom = 0;
  insets.left = 0;
  insets.right = 0;
});

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

function renderScrollBody(shell: (typeof SHELLS)[number], onBack?: () => void): string {
  return renderToStaticMarkup(
    shell === 'settings' ? (
      <SettingsScreenShell title="Settings" onBack={onBack}>
        body
      </SettingsScreenShell>
    ) : (
      <AisScreenShell title="Settings" onBack={onBack} scroll>
        body
      </AisScreenShell>
    ),
  );
}

describe('screen shells scroll body padding', () => {
  it('clears the floating tab bar when there is no back key', () => {
    const expected = String(tabScreenBottomPadding(false, insets.bottom));
    for (const shell of SHELLS) {
      expect(renderScrollBody(shell)).toContain(`data-padding-bottom="${expected}"`);
    }
  });

  it('clears the gesture bar when the back key brings its own spacing', () => {
    insets.bottom = 34;
    const expected = String(tabScreenBottomPadding(true, insets.bottom));
    for (const shell of SHELLS) {
      expect(renderScrollBody(shell, () => {})).toContain(`data-padding-bottom="${expected}"`);
    }
  });
});
