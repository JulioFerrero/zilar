// Message bubbles carry data-message-id, so a search hit can land on its message after the
// store loads the page; a pulse makes the jump visible even when the list cannot scroll.
let jumpToMessage: ((messageId: string) => boolean) | undefined;

/** Lets the mounted list reach a message it has not drawn yet. */
export function registerMessageList(jump: (messageId: string) => boolean): () => void {
  jumpToMessage = jump;
  return () => {
    if (jumpToMessage === jump) {
      jumpToMessage = undefined;
    }
  };
}

export function scrollToMessage(messageId: string): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  const element = findMessage(messageId);
  if (element !== null) {
    element.scrollIntoView({ block: 'center' });
    pulseMessage(element);
    return true;
  }
  if (jumpToMessage?.(messageId) !== true) {
    return false;
  }
  // A virtual list draws the row a frame or two after the jump.
  let frames = 20;
  const look = (): void => {
    const drawn = findMessage(messageId);
    if (drawn !== null) {
      pulseMessage(drawn);
    } else if (frames-- > 0) {
      requestAnimationFrame(look);
    }
  };
  requestAnimationFrame(look);
  return true;
}

function findMessage(messageId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`);
}

// The Web Animations API keeps the pulse out of CSS and off the layout; a runtime without
// it (jsdom) simply skips it.
function pulseMessage(element: Element): void {
  if (typeof element.animate !== 'function') {
    return;
  }
  element.animate(
    [
      { outline: '2px solid rgba(0, 0, 0, 0)', outlineOffset: '2px' },
      { outline: '2px solid var(--accent)', outlineOffset: '2px' },
      { outline: '2px solid rgba(0, 0, 0, 0)', outlineOffset: '2px' },
    ],
    { duration: 1200, easing: 'ease-out' },
  );
}
