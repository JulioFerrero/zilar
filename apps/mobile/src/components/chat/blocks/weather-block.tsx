import { weatherIcon, type WeatherIconKey } from '@zilar/chat-core';
import type { WeatherBlock as WeatherBlockData } from '@zilar/protocol';
import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Sun,
  Wind,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { TABULAR } from '@/components/chat/blocks/figure-block';
import { Text } from '@/components/ui/text';

// The glyphs of the weather board (`PhoneContent.dc.html:101-113`), keyed by the
// shared `weatherIcon` vocabulary so web and phone draw the same picture.
const ICONS: Record<WeatherIconKey, LucideIcon> = {
  sun: Sun,
  cloud: Cloud,
  rain: CloudRain,
  storm: CloudLightning,
  snow: CloudSnow,
  fog: CloudFog,
  wind: Wind,
};

/**
 * 22 · WEATHER: the place, the current reading and up to six hours. The hourly
 * strip is skipped when it is empty; each hour's glyph comes from the shared
 * `weatherIcon`, like the current condition.
 */
export function WeatherBlock({ block }: { block: WeatherBlockData }) {
  const Icon = ICONS[weatherIcon(block.condition)];
  const hourly = block.hourly ?? [];
  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-3">
        <Icon size={40} color="#ededed" strokeWidth={1.5} aria-hidden />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="font-medium" numberOfLines={1}>
            {block.place}
          </Text>
          <Text className="text-[13px] text-[#a1a1a1]" numberOfLines={1}>
            {block.condition} · H {block.high} · L {block.low}
          </Text>
        </View>
        <Text
          className="shrink-0 font-mono text-[34px] leading-[40px] font-medium tracking-[-0.02em]"
          style={TABULAR}
        >
          {block.temp}
        </Text>
      </View>
      {hourly.length === 0 ? null : (
        <View className="flex-row gap-1 rounded-[12px] border border-[#1f1f1f] bg-[#101010] px-1 py-2">
          {hourly.map((hour, index) => {
            const HourIcon = ICONS[weatherIcon(hour.condition)];
            return (
              <View key={`${hour.at}-${index}`} className="flex-1 items-center gap-1.5">
                <Text className="font-mono text-[10px] text-[#8a8a8a]">{hour.at}</Text>
                <HourIcon size={18} color="#d4d4d4" strokeWidth={1.8} aria-hidden />
                <Text className="text-center font-mono text-[14px]" style={TABULAR}>
                  {hour.temp}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
