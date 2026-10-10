import { createElement } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { IntegrationsStatus } from '@/lib/integrations-api';

// The screen body is the default export wrapped in `RequireAuth`; the inner
// body is not exported, so the test renders the default export with the auth
// guard and the data hook stubbed. `renderToStaticMarkup` never runs effects,
// so each case forces the page state through the `useState` mock (the
// `AuthFlow.test.tsx` pattern): the first object `useState` is the loaded
// status, the first string state is the `status`
// ('loading' | 'ready' | 'forbidden' | 'error').
//
// A token-shaped secret the fake status below carries in its non-secret
// fields would break the write-only rule if it reached the tree: no rendered
// tree may ever contain it (the write side — clearing the field after a save
// — is covered by the `useState('')` reset in each card).
const LEAKED_TOKEN = 'zilar-test-bot-token-123456-abcdef';

vi.mock('expo-router', () => ({
  useFocusEffect: () => {},
  useRouter: () => ({ back: () => {}, push: () => {} }),
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal',
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
  Pressable: 'Pressable',
  TextInput: 'TextInput',
  View: 'View',
}));

vi.mock('@/components/ui/use-key-press', () => ({
  useKeyPress: () => ({ pressed: false, reduceMotion: false, setPressed: () => {} }),
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));

vi.mock('lucide-react-native', () => ({
  CircleAlert: 'CircleAlert',
  Eye: 'Eye',
  EyeOff: 'EyeOff',
  Inbox: 'Inbox',
  Lock: 'Lock',
  Mail: 'Mail',
  Mic: 'Mic',
  RefreshCw: 'RefreshCw',
  Send: 'Send',
}));

vi.mock('@/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/settings/screen-shell', () => ({
  SettingsScreenShell: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: ({ visible, title }: { visible: boolean; title: string }) =>
    visible ? createElement('Text', null, title) : null,
}));

vi.mock('@/components/integrations/use-integrations-api', () => ({
  useIntegrationsApi: () => ({ api: {} }),
}));

vi.mock('@/lib/colors', () => ({
  ACCENT: '#ededed',
  DANGER: { dark: '#dc2626', light: '#dc2626' },
  ICON: '#d4d4d4',
  MUTED_FOREGROUND: '#a1a1a1',
}));

const READY_STATUS: IntegrationsStatus = {
  telegram: { configured: false, source: null },
  email: { configured: false, source: null, from: null },
  voiceTranscription: { configured: false, baseUrl: null, model: null },
  canManage: true,
};

let forcedObjects: unknown[] = [];
let forcedStatus: 'loading' | 'ready' | 'forbidden' | 'error' = 'loading';
let forcedError: { message: string } | undefined = undefined;
let forcedBooleans: boolean[] = [];
let objectCursor = 0;
let booleanCursor = 0;

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T): [T, Dispatch<SetStateAction<T>>] => {
      if (initial === null && objectCursor < forcedObjects.length) {
        const forced = forcedObjects[objectCursor] as unknown as T;
        objectCursor += 1;
        return [forced, (() => {}) as Dispatch<SetStateAction<T>>];
      }
      if (
        typeof initial === 'object' &&
        initial !== null &&
        !Array.isArray(initial) &&
        'message' in initial &&
        forcedError !== undefined
      ) {
        return [forcedError as unknown as T, (() => {}) as Dispatch<SetStateAction<T>>];
      }
      if (typeof initial === 'boolean' && booleanCursor < forcedBooleans.length) {
        const forced = forcedBooleans[booleanCursor] as unknown as T;
        booleanCursor += 1;
        return [forced, (() => {}) as Dispatch<SetStateAction<T>>];
      }
      // Only the page status state is forced: it is the one string state
      // whose initial ('loading') is non-empty, and the forced value is one
      // of the four page states. Field text (From, Base URL, Model) keeps its
      // initial so a prefilled sender renders with its real value.
      if (
        initial === 'loading' &&
        (forcedStatus === 'ready' || forcedStatus === 'forbidden' || forcedStatus === 'error')
      ) {
        return [forcedStatus as unknown as T, (() => {}) as Dispatch<SetStateAction<T>>];
      }
      return actual.useState(initial);
    },
  };
});

async function renderScreen(input: {
  data: IntegrationsStatus | null;
  status: 'loading' | 'ready' | 'forbidden' | 'error';
  error?: string | undefined;
  /** Boolean states forced in hook order (saved flags, confirm dialogs). */
  booleans?: boolean[] | undefined;
}): Promise<string> {
  forcedObjects = [input.data];
  forcedStatus = input.status;
  forcedError = input.error === undefined ? undefined : { message: input.error };
  forcedBooleans = input.booleans ?? [];
  objectCursor = 0;
  booleanCursor = 0;
  try {
    const module = await import('@/app/settings/integrations');
    return renderToStaticMarkup(createElement(module.default));
  } finally {
    forcedObjects = [];
    forcedStatus = 'loading';
    forcedError = undefined;
    forcedBooleans = [];
  }
}

describe('IntegrationsScreen', () => {
  it('shows loading while the status loads', async () => {
    const html = await renderScreen({ data: null, status: 'loading' });
    expect(html).toContain('Loading integrations');
  });

  it('gates non-owners with the owner sentence and no cards', async () => {
    const html = await renderScreen({ data: null, status: 'forbidden' });
    expect(html).toContain('Only the server owner can change these settings.');
    expect(html).not.toContain('Telegram bot');
    expect(html).not.toContain('Voice transcription');
    expect(html).not.toContain('Retry');
  });

  it('shows the error state with Retry', async () => {
    const html = await renderScreen({
      data: null,
      status: 'error',
      error: 'Could not load integrations.',
    });
    expect(html).toContain('Could not load integrations.');
    expect(html).toContain('Retry');
    expect(html).not.toContain('Only the server owner');
  });

  it('shows the three cards in the web order: Email, Voice, Telegram', async () => {
    const html = await renderScreen({ data: READY_STATUS, status: 'ready' });
    const emailAt = html.indexOf('Email');
    const voiceAt = html.indexOf('Voice transcription');
    const telegramAt = html.indexOf('Telegram bot');
    expect(emailAt).toBeGreaterThanOrEqual(0);
    expect(voiceAt).toBeGreaterThan(emailAt);
    expect(telegramAt).toBeGreaterThan(voiceAt);
  });

  it('shows Not set up pills and the required help lines', async () => {
    const html = await renderScreen({ data: READY_STATUS, status: 'ready' });
    expect(html).toContain('Not set up');
    expect(html).toContain('Use an address on a domain you verified in Resend.');
    expect(html).toContain(
      'Transcription on this phone needs no setup. This endpoint adds server transcripts.',
    );
    expect(html).toContain('Open @BotFather in Telegram');
  });

  it('shows the saved lines after a save', async () => {
    // Hook order of the boolean states: Email showKey/busy/saved,
    // Voice showKey/busy/saved/confirming/removing, Telegram the same five.
    const savedBooleans = [
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
    ];
    const html = await renderScreen({
      data: READY_STATUS,
      status: 'ready',
      booleans: savedBooleans,
    });
    expect(html).toContain('Saved. A test email is on its way to your address.');
    expect(html).toContain('Saved. Transcripts are on.');
    expect(html).toContain('Saved. Imports are on.');
  });

  it('prefills the From field with the saved sender, not the page status', async () => {
    const configured: IntegrationsStatus = {
      telegram: { configured: true, source: 'stored' },
      email: { configured: true, source: 'stored', from: 'Zilar <a@b.example>' },
      voiceTranscription: { configured: true, baseUrl: 'https://x.example', model: 'whisper-1' },
      canManage: true,
    };
    const html = await renderScreen({ data: configured, status: 'ready' });
    expect(html).toContain('value="Zilar &lt;a@b.example&gt;"');
    expect(html).toContain('value="https://x.example"');
    expect(html).not.toContain('value="ready"');
  });

  it('shows Email without Remove, and Remove on the other two when configured', async () => {
    const configured: IntegrationsStatus = {
      telegram: { configured: true, source: 'stored' },
      email: { configured: true, source: 'stored', from: 'Zilar <a@b.example>' },
      voiceTranscription: { configured: true, baseUrl: 'https://x.example', model: 'whisper-1' },
      canManage: true,
    };
    // Confirm dialogs open: Voice confirming (4th voice boolean) and
    // Telegram confirming (4th telegram boolean) forced true.
    const confirmingBooleans = [
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      true,
      false,
    ];
    const html = await renderScreen({
      data: configured,
      status: 'ready',
      booleans: confirmingBooleans,
    });
    expect(html).toContain('Connected');
    expect(html).toContain('Remove');
    expect(html).toContain('Remove the Telegram token?');
    expect(html).toContain('Remove the transcription endpoint?');
  });

  it('replaces fields with the env notices when managed by environment', async () => {
    const env: IntegrationsStatus = {
      telegram: { configured: true, source: 'env' },
      email: { configured: true, source: 'env', from: 'Zilar <a@b.example>' },
      voiceTranscription: { configured: false, baseUrl: null, model: null },
      canManage: true,
    };
    const html = await renderScreen({ data: env, status: 'ready' });
    expect(html).toContain('Set by environment');
    expect(html).toContain('The token is set by environment variable.');
    expect(html).toContain('Managed by environment');
    expect(html).toContain('Email is managed by environment variables on this server.');
  });

  it('never renders a secret the status carries', async () => {
    const carrying = {
      ...READY_STATUS,
      telegram: { configured: true, source: 'stored', botToken: LEAKED_TOKEN },
    } as unknown as IntegrationsStatus;
    const html = await renderScreen({ data: carrying, status: 'ready' });
    expect(html).toContain('Telegram bot');
    expect(html).not.toContain(LEAKED_TOKEN);
  });
});
