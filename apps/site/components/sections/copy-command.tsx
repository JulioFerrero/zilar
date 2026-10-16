'use client';

// effect-plain: the landing's copy button; the clipboard write and its short
// label timer are DOM-only, with no I/O, ports or app logic.
import { useEffect, useRef, useState } from 'react';
import styles from './install.module.css';

const INSTALL_COMMAND = 'curl -fsSL https://get.zilar.app | sh';

// How long the label reads "Copied" or "Select it" before returning to "Copy".
const RESET_MS = 1600;

export function CopyCommand() {
  const code = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [label, setLabel] = useState('Copy');

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  function show(next: string): void {
    setLabel(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setLabel('Copy'), RESET_MS);
  }

  // When the clipboard is unavailable, fall back to selecting the whole line so
  // the reader can copy it by hand.
  function selectCommand(): void {
    const element = code.current;
    if (element === null) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      show('Copied');
    } catch {
      selectCommand();
      show('Select it');
    }
  }

  return (
    <div className={styles.cmd}>
      <code ref={code}>{INSTALL_COMMAND}</code>
      <button className="key key-dark" type="button" onClick={() => void copy()}>
        {label}
      </button>
    </div>
  );
}
