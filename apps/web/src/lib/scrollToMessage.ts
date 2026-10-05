// Scrolls a loaded message into view: message bubbles carry
// `data-message-id`, so a search hit can land on its message after the
// store has loaded the history page containing it.
export function scrollToMessage(messageId: string): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  const element = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
  if (element === null) {
    return false;
  }
  element.scrollIntoView({ block: 'center' });
  return true;
}
