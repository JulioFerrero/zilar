import { useEffect, useRef } from 'react';
import { TextInput, View } from 'react-native';

import { cn } from '@/lib/utils';

import { OTP_LENGTH, applyOtpBackspace, applyOtpText, isOtpComplete, otpValue } from './otp';

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
  const refs = useRef<Array<TextInput | null>>([]);
  const digits = value.padEnd(OTP_LENGTH, ' ').slice(0, OTP_LENGTH).split('');
  const completedRef = useRef(false);

  useEffect(() => {
    completedRef.current = false;
  }, [value]);

  const focus = (index: number): void => {
    refs.current[index]?.focus();
  };

  const commit = (next: string, focusIndex: number): void => {
    onChange(next);
    focus(focusIndex);
    if (isOtpComplete(next) && !completedRef.current) {
      completedRef.current = true;
      onComplete?.(next);
    }
  };

  const handleChange = (index: number, text: string): void => {
    const state = applyOtpText(digits, index, text);
    commit(otpValue(state.digits), state.focusIndex);
  };

  const handleKeyPress = (index: number, key: string): void => {
    if (key !== 'Backspace' || digits[index]?.trim() !== '') {
      return;
    }
    const state = applyOtpBackspace(digits, index);
    commit(otpValue(state.digits), state.focusIndex);
  };

  return (
    <View accessibilityRole="none" accessibilityLabel={label} className="flex-row justify-center">
      {digits.map((digit, index) => (
        <TextInput
          // Position is the stable identity of each box.
          key={index}
          ref={(element) => {
            refs.current[index] = element;
          }}
          value={digit.trim()}
          editable={disabled !== true}
          autoFocus={index === 0}
          maxLength={OTP_LENGTH}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          accessibilityLabel={`Digit ${index + 1}`}
          accessibilityState={{ disabled: disabled === true }}
          onChangeText={(text) => handleChange(index, text)}
          onKeyPress={(event) => handleKeyPress(index, event.nativeEvent.key)}
          className={cn(
            'mx-1 h-11 w-11 rounded-lg border border-input bg-background text-center text-[20px] font-semibold text-foreground',
            invalid === true && 'border-danger',
            disabled === true && 'opacity-50',
          )}
        />
      ))}
    </View>
  );
}
