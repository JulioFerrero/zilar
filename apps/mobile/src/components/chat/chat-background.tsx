import { StyleSheet } from 'react-native';
import Svg, { Circle, Defs, Pattern, Rect } from 'react-native-svg';
import { chatGrid } from '@zilar/ui-tokens';

/** Black chat background with the 22 px dot grid (ui-style.md §2). */
export function ChatBackground() {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <Pattern
          id="zilar-dots"
          x="0"
          y="0"
          width={chatGrid.cell}
          height={chatGrid.cell}
          patternUnits="userSpaceOnUse"
        >
          <Circle
            cx={chatGrid.dotRadius}
            cy={chatGrid.dotRadius}
            r={chatGrid.dotRadius}
            fill={chatGrid.dot}
          />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill={chatGrid.background} />
      <Rect width="100%" height="100%" fill="url(#zilar-dots)" />
    </Svg>
  );
}
