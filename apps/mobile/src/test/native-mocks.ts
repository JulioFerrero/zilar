import { vi } from 'vitest';

// The native primitives the mobile component tests share. Registering these
// once here lets a test file that needs the same body drop its own `vi.mock`;
// a file that needs a different body still overrides it with its own `vi.mock`.

vi.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
  TextClassContext: { Provider: 'TextClassContextProvider' },
}));
