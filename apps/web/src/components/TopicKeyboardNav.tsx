import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';

/**
 * Arrow-key navigation across the topic list (T-0111): Up/Down moves focus
 * between topic links, Enter follows the focused one. The rows are plain
 * links, so this only moves DOM focus; activation stays native.
 *
 * The wrapper takes no props: it navigates whatever topic links are rendered
 * inside it. Only links that live in the chat list (`nav[aria-label="Chats"]`
 * under the same root) are navigated — message links, search hits and the
 * empty state never take part, even though they share the `/c/` prefix.
 */
export function TopicKeyboardNav({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') {
      return;
    }
    const root = event.currentTarget;
    const list = root.closest('nav[aria-label="Chats"]') ?? root;
    const links = Array.from(list.querySelectorAll<HTMLAnchorElement>('a[href^="/c/"]'));
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
