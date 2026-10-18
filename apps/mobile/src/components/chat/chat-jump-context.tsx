import { createContext, useContext, type ReactNode } from 'react';

/** A quote with no provider, or while selecting, stays plain text so select
 *  mode keeps the taps. */
const ChatJumpContext = createContext<((messageId: string) => void) | undefined>(undefined);

export function ChatJumpProvider({
  jumpTo,
  children,
}: {
  jumpTo: ((messageId: string) => void) | undefined;
  children: ReactNode;
}) {
  return <ChatJumpContext.Provider value={jumpTo}>{children}</ChatJumpContext.Provider>;
}

export function useChatJump(): ((messageId: string) => void) | undefined {
  return useContext(ChatJumpContext);
}
