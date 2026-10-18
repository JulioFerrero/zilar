import { createContext, useContext, type ReactNode } from 'react';

// The enclosing bubble's open-menu function, shared with the photo tiles it draws. The tiles are inner `Pressable`s, so a long hold fires their own `onPress` instead of the bubble's `onLongPress`; they forward the long-press to the menu while a short tap opens the viewer.
const MessageMenuContext = createContext<(() => void) | undefined>(undefined);

export function MessageMenuProvider({
  openMenu,
  children,
}: {
  openMenu: (() => void) | undefined;
  children: ReactNode;
}) {
  return <MessageMenuContext.Provider value={openMenu}>{children}</MessageMenuContext.Provider>;
}

export function useOpenMessageMenu(): (() => void) | undefined {
  return useContext(MessageMenuContext);
}
