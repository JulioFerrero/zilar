import { createContext, useContext, type ReactNode } from 'react';

/**
 * The enclosing chat's jump-to-message function, shared with inner tiles that
 * want a tap to scroll to another message (T-1667). The reply quote reads it to
 * jump to the quoted message; a quote with no provider, or one shown while
 * selecting, reads `undefined` and stays plain text so select mode keeps taps
 * for selecting.
 */
const ChatJumpContext = createContext<((messageId: string) => void) | undefined>(undefined);

/** Provides the chat's jump-to-message function to the tiles inside it. */
export function ChatJumpProvider({
  jumpTo,
  children,
}: {
  jumpTo: ((messageId: string) => void) | undefined;
  children: ReactNode;
}) {
  return <ChatJumpContext.Provider value={jumpTo}>{children}</ChatJumpContext.Provider>;
}

/** The enclosing chat's jump-to-message function, or undefined when there is none. */
export function useChatJump(): ((messageId: string) => void) | undefined {
  return useContext(ChatJumpContext);
}
