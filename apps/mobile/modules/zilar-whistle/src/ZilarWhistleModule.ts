import { Platform } from 'react-native';

import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * The `ZilarWhistle` native module handle, or null when it is not linked
 * (iOS, non-arm64 Android, Expo Go, or Jest/Vitest without the native side).
 * Kept in its own file so tests can mock exactly one seam.
 */
export interface ZilarWhistleNativeModule {
  isAvailable: () => boolean;
  modelStatus: () => string;
  loadModel: (path: string) => Promise<string>;
  sha256File: (path: string) => Promise<string>;
  transcribeFile: (path: string, language: string | null) => Promise<Record<string, unknown>>;
  transcribeRanges: (
    path: string,
    rangesMs: Array<[number, number]> | null,
    language: string | null,
  ) => Promise<Record<string, unknown>>;
}

export function getNativeModule(): ZilarWhistleNativeModule | null {
  if (Platform.OS !== 'android') {
    return null;
  }
  try {
    return requireOptionalNativeModule<ZilarWhistleNativeModule>('ZilarWhistle');
  } catch {
    return null;
  }
}
