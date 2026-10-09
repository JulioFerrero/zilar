import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

describe('copyText', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn(() => true),
      configurable: true,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
    Reflect.deleteProperty(document, 'execCommand');
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('writes through the Clipboard API when it works', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText });

    await copyText('https://zilar.test/invite/abc');

    expect(writeText).toHaveBeenCalledWith('https://zilar.test/invite/abc');
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it('falls back to a temporary textarea when the Clipboard API rejects', async () => {
    setClipboard({ writeText: vi.fn(() => Promise.reject(new Error('denied'))) });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });

    await copyText('secret-code');

    expect(execCommand).toHaveBeenCalledWith('copy');
    // The textarea is removed again after the copy.
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('uses the legacy path when there is no Clipboard API', async () => {
    setClipboard(undefined);
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });

    await copyText('hello');

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('rejects with the original error when the legacy copy throws, and removes the textarea', async () => {
    setClipboard(undefined);
    const failure = new Error('no execCommand');
    Object.defineProperty(document, 'execCommand', {
      value: () => {
        throw failure;
      },
      configurable: true,
    });

    await expect(copyText('hello')).rejects.toBe(failure);
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });
});
