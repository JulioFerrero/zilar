import type { MouseEvent } from 'react';

/** Controls inside a bubble keep their own double-click behaviour. */
const INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  '[role="button"]',
  '[role="switch"]',
  'img',
  'video',
  'audio',
  '[contenteditable="true"]',
].join(', ');

/**
 * A double-click on a message body starts a reply (Telegram desktop style),
 * unless it lands on a control or media. The word the browser selected under
 * the pointer is cleared so the reply bar opens with no stray highlight.
 */
export function doubleClickReply(onReply: () => void): (event: MouseEvent) => void {
  return (event) => {
    if ((event.target as HTMLElement).closest(INTERACTIVE_SELECTOR) !== null) {
      return;
    }
    window.getSelection()?.removeAllRanges();
    onReply();
  };
}
