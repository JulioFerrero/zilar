// Message bubbles carry data-message-id, so a search hit can land on its message after the
// store loads the page; a pulse makes the jump visible even when the list cannot scroll.
export function scrollToMessage(messageId: string): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  const element = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
  if (element === null) {
    return false;
  }
  element.scrollIntoView({ block: 'center' });
  pulseMessage(element);
  return true;
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
