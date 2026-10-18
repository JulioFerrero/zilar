import type { MouseEvent } from 'react';

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

export function doubleClickReply(onReply: () => void): (event: MouseEvent) => void {
  return (event) => {
    if ((event.target as HTMLElement).closest(INTERACTIVE_SELECTOR) !== null) {
      return;
    }
    window.getSelection()?.removeAllRanges();
    onReply();
  };
}
