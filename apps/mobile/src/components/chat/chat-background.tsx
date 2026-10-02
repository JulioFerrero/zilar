import { StyleSheet } from 'react-native';
import Svg, { Circle, Defs, Pattern, Rect } from 'react-native-svg';

/** Black chat background with the 22 px dot grid (ui-style.md §2). */
export function ChatBackground() {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <Pattern id="zilar-dots" x="0" y="0" width="22" height="22" patternUnits="userSpaceOnUse">
          <Circle cx="1" cy="1" r="1" fill="#1c1c1c" />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="#0a0a0a" />
      <Rect width="100%" height="100%" fill="url(#zilar-dots)" />
    </Svg>
  );
}
