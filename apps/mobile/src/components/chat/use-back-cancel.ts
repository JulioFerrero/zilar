import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';

/**
 * Android back runs `onCancel` instead of leaving the screen while the caller
 * is mounted. Returning `true` stops the router's own back, so the listener
 * swallows the press and a later press leaves the chat. The current `onCancel`
 * is read through a ref, so the listener stays subscribed across renders.
 */
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
