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
  type LucideIcon,
} from 'lucide-react';

// The glyphs of the weather board (`WebContent.dc.html:142,150-154`), keyed by
// the shared `weatherIcon` vocabulary so web and phone draw the same picture.
const ICONS: Record<WeatherIconKey, LucideIcon> = {
  sun: Sun,
  cloud: Cloud,
  rain: CloudRain,
  storm: CloudLightning,
  snow: CloudSnow,
  fog: CloudFog,
  wind: Wind,
};

/** 22 · WEATHER: the place, the current reading and up to six hours. */
export function WeatherBlock({ block }: { block: WeatherBlockData }) {
  const Icon = ICONS[weatherIcon(block.condition)];
  return (
    <>
      <div className="flex items-center gap-3">
        <Icon className="size-10 shrink-0 text-[#ededed]" strokeWidth={1.5} aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-medium">{block.place}</span>
          <span className="text-[12px] text-[#a1a1a1]">
            {block.condition} · H {block.high} · L {block.low}
          </span>
        </div>
        <span className="shrink-0 font-mono text-[34px] leading-10 font-medium tracking-[-0.02em] tabular-nums">
          {block.temp}
        </span>
      </div>
      {block.hourly !== undefined && block.hourly.length > 0 && (
        <div className="grid grid-flow-col auto-cols-fr gap-1.5 rounded-[12px] border border-[#1f1f1f] bg-[#101010] p-2">
          {block.hourly.map((hour, index) => {
            const HourIcon = ICONS[weatherIcon(hour.condition)];
            return (
              <div key={`${hour.at}-${index}`} className="flex flex-col items-center gap-1.5">
                <span className="font-mono text-[10px] text-[#8a8a8a]">{hour.at}</span>
                <HourIcon
                  className="size-[18px] text-[#d4d4d4]"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
                <span className="text-center font-mono text-[13px] tabular-nums">{hour.temp}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
