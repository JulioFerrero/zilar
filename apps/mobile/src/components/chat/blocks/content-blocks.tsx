import type {
  Block,
  EventBlock as EventBlockData,
  PlaceBlock as PlaceBlockData,
  WeatherBlock as WeatherBlockData,
  FileBlock as FileBlockData,
} from '@zilar/protocol';
import { type ReactNode, useMemo, useState } from 'react';
import { ImagesBlock } from '@/components/chat/blocks/images-block';
import { eventWhen, weatherIcon, type WeatherIconKey } from '@zilar/chat-core';
import { View, ViewStyle, Linking, Pressable, ActivityIndicator } from 'react-native';
import { TABULAR } from '@/components/chat/blocks/figure-block';
import { Text } from '@/components/ui/text';
import {
  Navigation,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Sun,
  Wind,
  type LucideIcon,
  Download,
  File,
} from 'lucide-react-native';
import { safeLinkTarget } from '@/lib/links';
import { Effect } from 'effect';
import { cardMediaUrl, OPEN_FAILED_MESSAGE } from '@/lib/attachment-common';
import { createAttachmentOpener } from '@/lib/attachment-opener';
import { API_URL } from '@/lib/auth';
import { getSessionToken } from '@/lib/session-token';

// The board's raised tile key (`PhoneContent.dc.html:148`, `.tilekey` at `:26`).
const TILE: ViewStyle = {
  experimental_backgroundImage: 'linear-gradient(180deg, #2c2c2c, #151515)',
  borderWidth: 1,
  borderColor: '#050505',
  boxShadow:
    'inset 0 1px 0 rgba(255,255,255,.16), inset 0 -1px 0 rgba(0,0,0,.65), 0 1px 0 rgba(0,0,0,.95)',
};

// The dark Download key, the same `KEY` as `place-block.tsx:11-16`.
const KEY: ViewStyle = {
  experimental_backgroundImage: 'linear-gradient(180deg, #1c1c1c, #121212)',
  borderWidth: 1,
  borderColor: '#2a2a2a',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06), 0 2px 6px rgba(0,0,0,.6)',
};

/**
 * 24 · FILE: the file key, the name, a mono `size · format · N rows` line and a
 * 40 px Download key (`PhoneContent.dc.html:144-160`). The bytes are fetched
 * only on tap, through the attachment opener with the session bearer.
 */
function FileBlock({ block }: { block: FileBlockData }) {
  const opener = useMemo(
    () => createAttachmentOpener({ apiUrl: API_URL, getToken: getSessionToken }),
    [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const meta =
    block.rows === undefined
      ? `${block.size} · ${block.format}`
      : `${block.size} · ${block.format} · ${block.rows} rows`;
  const download = (): void => {
    const url = cardMediaUrl(block.media);
    if (url === undefined || busy) {
      return;
    }
    setBusy(true);
    setError(undefined);
    Effect.runFork(
      Effect.tryPromise(() => opener.open(url, block.name)).pipe(
        Effect.match({
          onSuccess: (result) => {
            setBusy(false);
            setError(result.status === 'error' ? result.message : undefined);
          },
          onFailure: () => {
            setBusy(false);
            setError(OPEN_FAILED_MESSAGE);
          },
        }),
      ),
    );
  };
  return (
    <View className="gap-1.5">
      <View className="flex-row items-center gap-3">
        <View
          className="h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
          style={TILE}
        >
          <File size={18} color="#d4d4d4" aria-hidden />
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="font-medium" numberOfLines={1}>
            {block.name}
          </Text>
          <Text className="font-mono text-[11px] text-[#8a8a8a]" numberOfLines={1}>
            {meta}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Download"
          accessibilityState={{ busy, disabled: busy }}
          disabled={busy}
          onPress={download}
          className="h-10 w-10 shrink-0 items-center justify-center rounded-[12px] active:opacity-80"
          style={KEY}
        >
          {busy ? (
            <ActivityIndicator accessibilityLabel="Downloading" size="small" color="#d4d4d4" />
          ) : (
            <Download size={18} color="#d4d4d4" aria-hidden />
          )}
        </Pressable>
      </View>
      {error === undefined ? null : (
        <Text accessibilityRole="alert" className="text-[12px] text-[#f87171]">
          {error}
        </Text>
      )}
    </View>
  );
}

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
function WeatherBlock({ block }: { block: WeatherBlockData }) {
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

// The dark secondary key of the board (`PhoneContent.dc.html:90`), 40 px with a
// 12 px radius on the phone (README.md:33).
const DIRECTIONS_KEY: ViewStyle = {
  experimental_backgroundImage: 'linear-gradient(180deg, #1c1c1c, #121212)',
  borderWidth: 1,
  borderColor: '#2a2a2a',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06), 0 2px 6px rgba(0,0,0,.6)',
};

/** The Directions key: it opens the place's link like `link-block.tsx`. */
function DirectionsKey({ url }: { url: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Directions"
      onPress={() => {
        const target = safeLinkTarget(url);
        if (target !== undefined) {
          void Linking.openURL(target);
        }
      }}
      className="h-10 shrink-0 flex-row items-center justify-center gap-1.5 rounded-[12px] px-[14px] active:opacity-80"
      style={DIRECTIONS_KEY}
    >
      <Navigation size={14} color="#d4d4d4" aria-hidden />
      <Text className="text-[14px] font-medium text-[#ededed]">Directions</Text>
    </Pressable>
  );
}

/**
 * 21 · PLACE: the title, the address line and a Directions key when there is a
 * link. The board's map image is an uploaded media id and is out of scope, so
 * the card is drawn without it.
 */
function PlaceBlock({ block }: { block: PlaceBlockData }) {
  return (
    <View className="flex-row items-center gap-2.5">
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="font-medium" numberOfLines={1}>
          {block.title}
        </Text>
        {block.subtitle === undefined ? null : (
          <Text className="text-[13px] text-[#a1a1a1]" numberOfLines={2}>
            {block.subtitle}
          </Text>
        )}
      </View>
      {block.url === undefined ? null : <DirectionsKey url={block.url} />}
    </View>
  );
}

// The raised date tile of the board (`PhoneContent.dc.html:125`).
const EVENT_TILE: ViewStyle = {
  experimental_backgroundImage: 'linear-gradient(180deg, #2c2c2c, #151515)',
  borderWidth: 1,
  borderColor: '#050505',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.16), 0 1px 0 rgba(0,0,0,.95)',
};

/**
 * 23 · EVENT: a date tile, the title and the time range in the viewer's zone.
 * The board's calendar and map keys are out of scope (Wave 2 and an uploaded
 * image), so the card is drawn without them.
 */
function EventBlock({ block }: { block: EventBlockData }) {
  // The times are formatted in the zone the viewer is in, which is exactly what
  // an ISO timestamp has to be shown as (`eventWhen`).
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const when = eventWhen(block.startAt, block.endAt, timeZone);
  return (
    <View className="flex-row items-center gap-3">
      <View
        className="h-[54px] w-[50px] shrink-0 items-center justify-center rounded-[12px]"
        style={EVENT_TILE}
      >
        <Text className="font-mono text-[10px] text-[#a1a1a1]">{when.month}</Text>
        <Text className="font-mono text-[21px] leading-[26px] font-semibold" style={TABULAR}>
          {when.day}
        </Text>
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="font-medium" numberOfLines={1}>
          {block.title}
        </Text>
        <Text className="text-[13px] text-[#a1a1a1]" numberOfLines={2}>
          {when.line}
          {block.detail === undefined ? '' : ` · ${block.detail}`}
        </Text>
      </View>
    </View>
  );
}

/** The kinds the content group draws on the phone: `images` (20), `place`
 * (21), `weather` (22), `event` (23) and `file` (24). */
export const CONTENT_KINDS: ReadonlySet<Block['kind']> = new Set<Block['kind']>([
  'images',
  'place',
  'weather',
  'event',
  'file',
]);

/**
 * The content group's one dispatch point: `images` (20), `place` (21),
 * `weather` (22), `event` (23) and `file` (24). The bodies follow the board
 * `docs/design/mockups/blocks/PhoneContent.dc.html`.
 */
export function renderContentBlock(
  block: Extract<Block, { kind: 'images' | 'place' | 'weather' | 'event' | 'file' }>,
  _showHeading: boolean,
): ReactNode {
  switch (block.kind) {
    case 'images':
      return <ImagesBlock block={block} />;
    case 'place':
      return <PlaceBlock block={block} />;
    case 'weather':
      return <WeatherBlock block={block} />;
    case 'event':
      return <EventBlock block={block} />;
    case 'file':
      return <FileBlock block={block} />;
  }
}
