import { router } from 'expo-router';
import { Text as RNText, type StyleProp, type TextStyle } from 'react-native';

import { LONG_PRESS_MS } from '@/components/chat/message-bubble-decor';
import { useOpenMessageMenu } from '@/components/chat/message-menu-context';
import { usePersonRoute } from '@/components/chat/person-pressable';

/**
 * A mention chip that opens the person it names when the app can place them
 * (T-1877): a contact or an existing chat opens its DM, anyone else with a
 * handle opens their profile. A nested RN `Text` cannot sit inside a
 * `Pressable`, so the chip handles its own taps; with a link it also forwards
 * the bubble's long hold to the message menu.
 */
export function MentionText({
  jid,
  text,
  style,
}: {
  jid: string;
  text: string;
  style?: StyleProp<TextStyle>;
}) {
  const route = usePersonRoute({ jid });
  const openMenu = useOpenMessageMenu();
  if (route === undefined) {
    return <RNText style={style}>{text}</RNText>;
  }
  // The chip swallows the enclosing bubble's `onLongPress` once it handles
  // taps, so forward the menu open while a short tap opens the person.
  const longPress =
    openMenu === undefined ? {} : { onLongPress: openMenu, delayLongPress: LONG_PRESS_MS };
  return (
    <RNText
      style={style}
      accessibilityRole="link"
      onPress={() => router.push(route)}
      {...longPress}
    >
      {text}
    </RNText>
  );
}
