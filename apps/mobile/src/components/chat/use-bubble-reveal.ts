import type { UiMessage } from '@zilar/chat-core';
import { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';

import { GENERATING_FOREGROUND, SWAP_MS } from '@/components/chat/message-bubble-decor';
import { type ActiveSource, useSmoothText } from '@/lib/use-smooth-text';

export function useBubbleReveal({
  message,
  outgoing,
  draft,
  revealTurnId,
  reduceMotion,
  appActiveSource,
}: {
  message: UiMessage;
  outgoing: boolean;
  draft: boolean;
  revealTurnId: string | undefined;
  reduceMotion: boolean;
  appActiveSource: ActiveSource;
}) {
  const beyondDraft = revealTurnId !== undefined && !draft;
  const animate = draft || beyondDraft;
  const { text, done } = useSmoothText(message.text ?? '', {
    animate,
    initial: 'full',
    reducedMotion: reduceMotion,
    active: appActiveSource,
  });
  const generating = draft || (beyondDraft && !done);
  // A bubble ever written live keeps the recessed shell and fades the incoming look in over it, so the swap has no jump.
  const everLive = !outgoing && (draft || revealTurnId !== undefined);
  const textColor = outgoing ? '#0a0a0a' : generating ? GENERATING_FOREGROUND : '#ededed';
  const [swap] = useState(() => new Animated.Value(generating ? 0 : 1));
  const wasGenerating = useRef(generating);
  useEffect(() => {
    if (wasGenerating.current && !generating) {
      if (reduceMotion) {
        swap.setValue(1);
      } else {
        Animated.timing(swap, {
          toValue: 1,
          duration: SWAP_MS,
          useNativeDriver: true,
        }).start();
      }
    } else if (!wasGenerating.current && generating) {
      swap.setValue(0);
    }
    wasGenerating.current = generating;
  }, [generating, reduceMotion, swap]);
  return { text, generating, everLive, textColor, swap };
}
