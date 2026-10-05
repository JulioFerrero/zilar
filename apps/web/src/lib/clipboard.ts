/**
 * Copies text to the clipboard. Uses the async Clipboard API when available and
 * falls back to a temporary textarea with `document.execCommand`.
 */
export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // The Clipboard API was rejected; try the legacy path below.
    }
  }
  legacyCopy(text);
}

function legacyCopy(text: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (typeof document.execCommand === 'function') {
      document.execCommand('copy');
    }
  } finally {
    document.body.removeChild(textarea);
  }
}
