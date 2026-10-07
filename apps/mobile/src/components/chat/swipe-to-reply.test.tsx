import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const { swipeable } = vi.hoisted(() => ({ swipeable: vi.fn() }));

vi.mock('react-native-gesture-handler/ReanimatedSwipeable', () => ({
  default: (props: { children: unknown; enabled?: boolean }) => {
    swipeable(props);
    return props.children;
  },
  SwipeDirection: { LEFT: 'left', RIGHT: 'right' },
}));

vi.mock('react-native-reanimated', () => ({
  default: 'Animated',
  useAnimatedStyle: () => ({}),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: async () => {},
  ImpactFeedbackStyle: { Light: 'light' },
}));

vi.mock('lucide-react-native', () => ({ Reply: 'Reply' }));

import { SwipeToReply } from './swipe-to-reply';

describe('SwipeToReply', () => {
  it('passes enabled={false} to Swipeable', () => {
    swipeable.mockClear();
    renderToStaticMarkup(
      <SwipeToReply color="#000" onReply={() => {}} enabled={false}>
        row
      </SwipeToReply>,
    );
    expect(swipeable).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('defaults enabled to true', () => {
    swipeable.mockClear();
    renderToStaticMarkup(
      <SwipeToReply color="#000" onReply={() => {}}>
        row
      </SwipeToReply>,
    );
    expect(swipeable).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });
});
