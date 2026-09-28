export const OTP_LENGTH = 6;

export interface OtpState {
  digits: string[];
  focusIndex: number;
}

function emptyDigits(): string[] {
  return Array.from({ length: OTP_LENGTH }, () => '');
}

/** Splits a code string into the six boxes. */
export function splitOtp(value: string): string[] {
  const digits = emptyDigits();
  for (let index = 0; index < value.length && index < OTP_LENGTH; index += 1) {
    const digit = value[index];
    digits[index] = digit !== undefined && /\d/.test(digit) ? digit : '';
  }
  return digits;
}

export function otpValue(digits: readonly string[]): string {
  return digits.join('');
}

export function isOtpComplete(value: string): boolean {
  return value.length === OTP_LENGTH && /^\d+$/.test(value);
}

/**
 * One box changed. A single digit advances the focus; a multi-character change
 * is a paste and fills from the first box.
 */
export function applyOtpText(current: readonly string[], index: number, text: string): OtpState {
  const cleaned = text.replace(/\D/g, '');
  if (cleaned.length === 0) {
    const digits = [...current];
    digits[index] = '';
    return { digits, focusIndex: index };
  }
  if (cleaned.length > 1) {
    return applyOtpPaste(cleaned);
  }
  const digits = [...current];
  digits[index] = cleaned;
  return { digits, focusIndex: Math.min(index + 1, OTP_LENGTH - 1) };
}

/** A pasted code fills the boxes from the start. */
export function applyOtpPaste(text: string): OtpState {
  const cleaned = text.replace(/\D/g, '').slice(0, OTP_LENGTH);
  const digits = emptyDigits();
  for (let index = 0; index < cleaned.length; index += 1) {
    digits[index] = cleaned[index] ?? '';
  }
  return { digits, focusIndex: Math.min(cleaned.length, OTP_LENGTH - 1) };
}

/** Backspace clears the box, or moves to the previous one when already empty. */
export function applyOtpBackspace(current: readonly string[], index: number): OtpState {
  const digits = [...current];
  if (digits[index] !== '') {
    digits[index] = '';
    return { digits, focusIndex: index };
  }
  const previous = Math.max(index - 1, 0);
  digits[previous] = '';
  return { digits, focusIndex: previous };
}
