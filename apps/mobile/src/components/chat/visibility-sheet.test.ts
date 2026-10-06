import { describe, expect, it, vi } from 'vitest';

import { mayChangeVisibility, visibilityReasonText, visibilitySaveError } from './visibility-sheet';
import { DirectoryApiError } from '@/lib/directory-api';

// The sheet imports `react-native` (Modal/Pressable), so it is stubbed like
// `invite-links-sheet.test.tsx` — the helpers under test are pure.
vi.mock('react-native', () => ({
  Keyboard: { addListener: () => ({ remove: () => {} }) },
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Modal: 'Modal',
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  TextInput: 'TextInput',
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

// The sheet renders through the kit `BottomSheet` (T-0315); stub it so the
// pure-helper tests never load the shell's hooks. Same pattern as
// `pins-sheet.test.tsx`.
vi.mock('@/components/ui/bottom-sheet', () => ({
  BottomSheet: ({ title, children }: { title?: string; children?: unknown }) => ({
    type: 'BottomSheet',
    props: { children: [title, children] },
  }),
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

// The sheet itself is a `Modal` over the store and the clipboard bridge, so
// Node tests cover the permission rule and the error lines (never raw
// server text): owner only like the web panel, handle taken names the
// retry, the 14-day interval names the wait.
describe('visibility sheet', () => {
  it('gates on the owner role only', () => {
    expect(mayChangeVisibility('owner')).toBe(true);
    expect(mayChangeVisibility('admin')).toBe(false);
    expect(mayChangeVisibility('member')).toBe(false);
    expect(mayChangeVisibility(undefined)).toBe(false);
  });

  it('names the handle check reasons', () => {
    expect(visibilityReasonText('taken')).toBe('That handle is taken. Try another.');
    expect(visibilityReasonText('invalid')).toContain('3–32 characters');
    expect(visibilityReasonText('reserved')).toBe('That handle is reserved. Try another.');
    expect(visibilityReasonText('rate_limited')).toContain('Too many checks');
  });

  it('maps save failures without raw server text', () => {
    expect(visibilitySaveError(new DirectoryApiError(409, 'handle_taken', 'taken'))).toBe(
      'That handle was just taken. Try another.',
    );
    expect(visibilitySaveError(new DirectoryApiError(409, 'handle_change_too_soon', 'soon'))).toBe(
      'That handle changed recently. Try again later.',
    );
    expect(visibilitySaveError(new DirectoryApiError(404, 'not_found', 'gone'))).toBe(
      'That group is no longer available.',
    );
    expect(visibilitySaveError(new Error('boom'))).toBe(
      'Could not save the visibility. Try again.',
    );
  });
});
