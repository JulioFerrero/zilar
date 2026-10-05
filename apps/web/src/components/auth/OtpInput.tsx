import { useRef } from 'react';
import { cn } from '@/lib/utils';

const LENGTH = 6;

/** Six digit boxes: auto-advance, backspace, and paste the whole code. */
export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  label = 'Verification code',
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  label?: string;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = value.padEnd(LENGTH, ' ').slice(0, LENGTH).split('');

  const commit = (next: string): void => {
    const trimmed = next.replace(/\s+$/, '');
    onChange(trimmed);
    if (trimmed.length === LENGTH) {
      onComplete?.(trimmed);
    }
  };

  const setAt = (index: number, digit: string): string => {
    const next = digits
      .map((current, position) => (position === index ? digit : current))
      .join('')
      .slice(0, LENGTH);
    return next;
  };

  const handleChange = (index: number, raw: string): void => {
    const digit = raw.replace(/\D/g, '').slice(-1);
    commit(setAt(index, digit === '' ? ' ' : digit));
    if (digit !== '') {
      refs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (event: React.ClipboardEvent): void => {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, LENGTH);
    if (pasted === '') {
      return;
    }
    event.preventDefault();
    commit(pasted.padEnd(LENGTH, ' '));
    refs.current[Math.min(pasted.length, LENGTH - 1)]?.focus();
  };

  const handleKeyDown = (index: number, event: React.KeyboardEvent): void => {
    if (event.key === 'Backspace' && digits[index]?.trim() === '') {
      event.preventDefault();
      commit(setAt(index - 1, ' '));
      refs.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowLeft') {
      refs.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowRight') {
      refs.current[index + 1]?.focus();
    }
  };

  return (
    <div role="group" aria-label={label} className="flex justify-center gap-2">
      {digits.map((digit, index) => (
        <input
          // Position is the stable identity of each box.
          key={index}
          ref={(element) => {
            refs.current[index] = element;
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          value={digit.trim()}
          disabled={disabled}
          aria-label={`Digit ${index + 1}`}
          aria-invalid={invalid === true}
          onChange={(event) => handleChange(index, event.target.value)}
          onPaste={handlePaste}
          onKeyDown={(event) => handleKeyDown(index, event)}
          className={cn(
            'size-11 rounded-lg border bg-background text-center text-[20px] font-semibold outline-none',
            'focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40',
            invalid === true ? 'border-danger' : 'border-input',
            disabled === true && 'opacity-50',
          )}
        />
      ))}
    </div>
  );
}
