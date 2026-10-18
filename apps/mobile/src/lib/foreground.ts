import type { OnForeground } from '@zilar/client-core';
import { AppState } from 'react-native';

/** Subscribes to the app returning to the foreground. */
export const onForeground: OnForeground = (cb) => {
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      cb();
    }
  });
  return () => subscription.remove();
};
