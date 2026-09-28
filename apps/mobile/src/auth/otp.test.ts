import { describe, expect, it } from 'vitest';

import {
  OTP_LENGTH,
  applyOtpBackspace,
  applyOtpPaste,
  applyOtpText,
  isOtpComplete,
  otpValue,
  splitOtp,
} from './otp';

const EMPTY = splitOtp('');

describe('splitOtp', () => {
  it('pads to six boxes and drops non-digits', () => {
    expect(splitOtp('12')).toEqual(['1', '2', '', '', '', '']);
    expect(splitOtp('12a')).toEqual(['1', '2', '', '', '', '']);
    expect(splitOtp('1234567')).toEqual(['1', '2', '3', '4', '5', '6']);
  });
});

describe('auto-advance', () => {
  it('fills the box and moves focus to the next one', () => {
    const state = applyOtpText(EMPTY, 0, '1');
    expect(state.digits).toEqual(['1', '', '', '', '', '']);
    expect(state.focusIndex).toBe(1);
    expect(otpValue(state.digits)).toBe('1');
  });

  it('keeps focus on the last box', () => {
    const state = applyOtpText(splitOtp('12345'), 5, '6');
    expect(otpValue(state.digits)).toBe('123456');
    expect(state.focusIndex).toBe(OTP_LENGTH - 1);
    expect(isOtpComplete(otpValue(state.digits))).toBe(true);
  });

  it('replaces a digit without advancing past the end', () => {
    const state = applyOtpText(splitOtp('123456'), 5, '9');
    expect(otpValue(state.digits)).toBe('123459');
    expect(state.focusIndex).toBe(5);
  });
});

describe('paste', () => {
  it('accepts a whole code pasted into one box', () => {
    const state = applyOtpText(EMPTY, 2, '654321');
    expect(otpValue(state.digits)).toBe('654321');
    expect(state.focusIndex).toBe(5);
  });

  it('accepts a shorter paste from the start', () => {
    const state = applyOtpPaste('654-321');
    expect(otpValue(state.digits)).toBe('654321');
  });

  it('ignores non-digits in a paste', () => {
    const state = applyOtpPaste(' 12 34 56 ');
    expect(otpValue(state.digits)).toBe('123456');
  });
});

describe('backspace', () => {
  it('clears the current box when it has a digit', () => {
    const state = applyOtpBackspace(splitOtp('123'), 2);
    expect(otpValue(state.digits)).toBe('12');
    expect(state.focusIndex).toBe(2);
  });

  it('moves back and clears the previous box when empty', () => {
    const state = applyOtpBackspace(splitOtp('123'), 3);
    expect(otpValue(state.digits)).toBe('12');
    expect(state.focusIndex).toBe(2);
  });
});

describe('isOtpComplete', () => {
  it('requires exactly six digits', () => {
    expect(isOtpComplete('123456')).toBe(true);
    expect(isOtpComplete('12345')).toBe(false);
    expect(isOtpComplete('12345a')).toBe(false);
  });
});
