import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';

/**
 * Arrow keys move focus between `data-topic-row` rows inside the chat list;
 * links elsewhere on the page never take part.
 */
export function TopicKeyboardNav({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    // Alt/Ctrl/Meta+arrows belong to the window-level chat switch.
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') {
      return;
    }
    const root = event.currentTarget;
    const list = root.closest('nav[aria-label="Chats"]') ?? root;
    const links = Array.from(list.querySelectorAll<HTMLAnchorElement>('a[data-topic-row]'));
    const current = document.activeElement;
    const index = links.findIndex((link) => link === current);
    if (event.key === 'Enter') {
      if (current instanceof HTMLAnchorElement && links.includes(current)) {
        event.preventDefault();
        navigate(current.getAttribute('href') ?? '/');
      }
      return;
    }
    event.preventDefault();
    if (links.length === 0) {
      return;
    }
    const next =
      index === -1
        ? (links[0] as HTMLAnchorElement)
        : event.key === 'ArrowDown'
          ? (links[(index + 1) % links.length] as HTMLAnchorElement)
          : (links[(index - 1 + links.length) % links.length] as HTMLAnchorElement);
    next.focus();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}
