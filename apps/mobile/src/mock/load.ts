/**
 * The mock loading scenarios used for screenshots (T-0067). Real mock mode has
 * no slow or failing backend, so `EXPO_PUBLIC_GALENA_MOCK_LOAD` selects a fixed
 * state, following the `EXPO_PUBLIC_GALENA_MOCK_DRAFT` convention (T-0056):
 *
 * - `slow`: nothing has arrived yet (chat-list skeleton, and a chat opened now
 *   shows the message skeleton); a real list arrives after `MOCK_LOAD_DELAY_MS`;
 * - `error`: the list load failed and a Retry is offered, and every history page
 *   failed too (so an open chat shows its own Retry);
 * - `empty`: the list loaded and is genuinely empty ("No chats yet");
 * - `no-messages`: chats exist but have no history yet ("No messages yet").
 */
export type MockLoadScenario = 'slow' | 'error' | 'empty' | 'no-messages';

/** How long the `slow` scenario stays loading before its list arrives. */
export const MOCK_LOAD_DELAY_MS = 1500;

/** Reads the screenshot scenario from the build-time env, or `undefined`. */
export function readMockLoadScenario(
  env: Record<string, string | undefined> = process.env,
): MockLoadScenario | undefined {
  const value = env['EXPO_PUBLIC_GALENA_MOCK_LOAD'];
  return value === 'slow' || value === 'error' || value === 'empty' || value === 'no-messages'
    ? value
    : undefined;
}
