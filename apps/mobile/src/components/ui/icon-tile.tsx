import type { ReactNode } from 'react';
import { View } from 'react-native';

import { iconKey } from '@/lib/depth';

type IconTileProps = {
  children: ReactNode;
  size?: number;
  radius?: number;
  testID?: string;
};

export function IconTile({ children, size = 34, radius = 10, testID }: IconTileProps) {
  return (
    <View
      testID={testID}
      className="items-center justify-center"
      style={[iconKey, { width: size, height: size, borderRadius: radius }]}
    >
      {children}
    </View>
  );
}
