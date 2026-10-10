import { createElement } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { AuthFlow } from './AuthFlow';

vi.mock('expo-linear-gradient', () => ({
  LinearGradient: 'LinearGradient',
}));

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ replace: () => {} }),
}));

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options['ios'] },
  TextInput: 'TextInput',
  View: 'View',
}));

vi.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
}));

vi.mock('@/components/ui/use-key-press', () => ({
  useKeyPress: () => ({ pressed: false, reduceMotion: false, setPressed: () => {} }),
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
  TextClassContext: { Provider: 'TextClassContextProvider' },
}));

vi.mock('./OtpInput', () => ({
  OtpInput: 'OtpInput',
}));

vi.mock('./session', () => ({
  requestSignInCode: vi.fn(async () => ({})),
  useAuthStore: (select: (state: { signIn: () => Promise<unknown> }) => unknown) =>
    select({ signIn: async () => ({ ok: true, me: { name: 'Ada' } }) }),
}));

// `renderToStaticMarkup` never runs effects or taps, so the flow always
// starts on the email step. To cover the code step too, the first `useState`
// (the flow's `step`, whose initial value is the string 'email') can be
// forced to 'code'. Every other hook passes through untouched.
let forcedStep: 'email' | 'code' | undefined = undefined;
let stepForced = false;

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T): [T, Dispatch<SetStateAction<T>>] => {
      if (forcedStep !== undefined && !stepForced && typeof initial === 'string') {
        stepForced = true;
        return [forcedStep as unknown as T, (() => {}) as Dispatch<SetStateAction<T>>];
      }
      return actual.useState(initial);
    },
  };
});

const EMAIL_HINT = 'New here? Open the invite link you were sent first, then sign in.';
const CODE_HINT =
  'No email after a minute? Check spam, and if you are new here you need an invite link from whoever runs this server.';

function renderFlow(props: { inviteCode?: string; step?: 'email' | 'code' }): string {
  forcedStep = props.step;
  stepForced = false;
  try {
    return renderToStaticMarkup(
      createElement(AuthFlow, {
        heading: 'Sign in to Zilar',
        ...(props.inviteCode === undefined ? {} : { inviteCode: props.inviteCode }),
      }),
    );
  } finally {
    forcedStep = undefined;
  }
}

function leaksNothing(text: string): void {
  expect(text.toLowerCase()).not.toMatch(/\b(account|registered|exists)\b/);
}

describe('AuthFlow sign-in hints (T-0180)', () => {
  it('shows the email-step hint without an invite code, not with one', () => {
    expect(renderFlow({})).toContain(EMAIL_HINT);
    expect(renderFlow({ inviteCode: 'CODE123' })).not.toContain(EMAIL_HINT);
  });

  it('shows the code-step hint without an invite code, not with one', () => {
    const login = renderFlow({ step: 'code' });
    expect(login).toContain(CODE_HINT);
    expect(login).toContain('Resend code');
    expect(renderFlow({ step: 'code', inviteCode: 'CODE123' })).not.toContain(CODE_HINT);
  });

  it('leaks nothing about accounts in either hint or either step', () => {
    leaksNothing(EMAIL_HINT);
    leaksNothing(CODE_HINT);
    leaksNothing(renderFlow({}));
    leaksNothing(renderFlow({ step: 'code' }));
    leaksNothing(renderFlow({ inviteCode: 'CODE123' }));
    leaksNothing(renderFlow({ step: 'code', inviteCode: 'CODE123' }));
  });
});
