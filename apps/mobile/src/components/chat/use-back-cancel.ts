import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';

// Android back runs `onCancel` instead of leaving while the caller is mounted; `true` stops the router's own back. The current `onCancel` is read through a ref, so the listener stays subscribed.
export function useBackCancel(onCancel: () => void): void {
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onCancelRef.current();
      return true;
    });
    return () => subscription.remove();
  }, []);
}
