import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OtpInput } from './OtpInput';

describe('OtpInput', () => {
  it('accepts a pasted code and reports it complete', () => {
    const onChange = vi.fn();
    const onComplete = vi.fn();
    render(<OtpInput value="" onChange={onChange} onComplete={onComplete} />);

    fireEvent.paste(screen.getByLabelText('Digit 1'), {
      clipboardData: { getData: () => '123456' },
    });

    expect(onChange).toHaveBeenCalledWith('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('auto-advances to the next box as digits are typed', () => {
    const onChange = vi.fn();
    render(<OtpInput value="" onChange={onChange} />);

    const first = screen.getByLabelText('Digit 1');
    first.focus();
    fireEvent.change(first, { target: { value: '7' } });

    expect(onChange).toHaveBeenCalledWith('7');
    expect(document.activeElement).toBe(screen.getByLabelText('Digit 2'));
  });

  it('marks the boxes invalid', () => {
    render(<OtpInput value="000000" onChange={() => {}} invalid />);
    expect(screen.getByLabelText('Digit 1').getAttribute('aria-invalid')).toBe('true');
  });
});
