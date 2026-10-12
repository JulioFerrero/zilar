import { createContext, useContext, type ReactNode } from 'react';

/**
 * The enclosing bubble's open-menu function, shared with the photo tiles it
 * draws (T-1275). The tiles are inner `Pressable`s, so a long hold fires their
 * own `onPress` on release instead of the outer bubble's `onLongPress`; they
 * read this and forward the long-press to the menu, while a short tap still
 * opens the viewer. A bubble with no provider, or one still generating, reads
 * `undefined`.
 */
const MessageMenuContext = createContext<(() => void) | undefined>(undefined);

/** Provides the bubble's open-menu function to the photo tiles inside it. */
export function MessageMenuProvider({
  openMenu,
  children,
}: {
  openMenu: (() => void) | undefined;
  children: ReactNode;
}) {
  return <MessageMenuContext.Provider value={openMenu}>{children}</MessageMenuContext.Provider>;
}

/** The enclosing bubble's open-menu function, or undefined when there is none. */
export function useOpenMessageMenu(): (() => void) | undefined {
  return useContext(MessageMenuContext);
}
