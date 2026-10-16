import { createContext, useContext, type ReactNode } from 'react';
import { Platform } from 'react-native';

const noopNotify = (): void => {};

/**
 * The enclosing chat's short-notice function, shared with inner tiles that want
 * a quiet confirmation (T-1693): the chat thread's one toast shows it. A tile
 * with no provider gets a no-op, so it never has to know whether a thread is
 * around.
 */
const ChatNoticeContext = createContext<(text: string) => void>(noopNotify);

/** Provides the chat's notice function to the tiles inside it. */
export function ChatNoticeProvider({
  notify,
  children,
}: {
  notify: (text: string) => void;
  children: ReactNode;
}) {
  return <ChatNoticeContext.Provider value={notify}>{children}</ChatNoticeContext.Provider>;
}

/** The enclosing chat's short-notice function; a no-op when there is none. */
export function useChatNotice(): (text: string) => void {
  return useContext(ChatNoticeContext);
}

/**
 * Android 13 (API 33) and later show their own clipboard confirmation, so the
 * phone adds none there; iOS and Android 12 or older get the app's "Copied".
 */
export function systemConfirmsCopy(): boolean {
  return Platform.OS === 'android' && Number(Platform.Version) >= 33;
}
