import { createContext, useContext, type ReactNode } from 'react';
import { Platform } from 'react-native';

const noopNotify = (): void => {};

const ChatNoticeContext = createContext<(text: string) => void>(noopNotify);

export function ChatNoticeProvider({
  notify,
  children,
}: {
  notify: (text: string) => void;
  children: ReactNode;
}) {
  return <ChatNoticeContext.Provider value={notify}>{children}</ChatNoticeContext.Provider>;
}

export function useChatNotice(): (text: string) => void {
  return useContext(ChatNoticeContext);
}

/** Android 13+ shows its own clipboard confirmation, so the phone adds none
 *  there; iOS and Android 12 or older get the app's "Copied". */
export function systemConfirmsCopy(): boolean {
  return Platform.OS === 'android' && Number(Platform.Version) >= 33;
}
