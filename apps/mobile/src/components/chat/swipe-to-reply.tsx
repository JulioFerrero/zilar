import * as Haptics from 'expo-haptics';
import { Reply } from 'lucide-react-native';
import { useRef, type ReactNode } from 'react';
import Swipeable, {
  SwipeDirection,
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

const REPLY_THRESHOLD = 60;

function ReplyAction({ progress, color }: { progress: SharedValue<number>; color: string }) {
  const animatedStyle = useAnimatedStyle(() => {
    const value = Math.min(progress.value, 1);
    return { opacity: value, transform: [{ scale: 0.7 + 0.3 * value }] };
  });
  return (
    <Animated.View
      style={[animatedStyle, { width: 72, alignItems: 'center', justifyContent: 'center' }]}
    >
      <Reply size={22} color={color} />
    </Animated.View>
  );
}

type SwipeToReplyProps = {
  color: string;
  onReply: () => void;
  children: ReactNode;
};

/**
 * Wraps a message row so swiping it right reveals a reply arrow. Releasing past
 * ~60 px triggers a light haptic and sets the reply.
 */
export function SwipeToReply({ color, onReply, children }: SwipeToReplyProps) {
  const swipeRef = useRef<SwipeableMethods>(null);

  const haptic = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  return (
    <Swipeable
      ref={swipeRef}
      leftThreshold={REPLY_THRESHOLD}
      overshootLeft={false}
      renderLeftActions={(progress) => <ReplyAction progress={progress} color={color} />}
      onSwipeableWillOpen={(direction) => {
        if (direction === SwipeDirection.RIGHT) {
          haptic();
        }
      }}
      onSwipeableOpen={(direction) => {
        swipeRef.current?.close();
        if (direction === SwipeDirection.RIGHT) {
          onReply();
        }
      }}
    >
      {children}
    </Swipeable>
  );
}
