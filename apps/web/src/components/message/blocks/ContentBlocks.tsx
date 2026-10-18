import { eventWhen, weatherIcon, type WeatherIconKey } from '@zilar/chat-core';
import type {
  EventBlock as EventBlockData,
  FileBlock as FileBlockData,
  ImagesBlock as ImagesBlockData,
  PlaceBlock as PlaceBlockData,
  WeatherBlock as WeatherBlockData,
} from '@zilar/protocol';
import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Download,
  File,
  ImageOff,
  Navigation,
  Sun,
  Wind,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { BLOCK_KEY } from './blockKey';

const EVENT_TILE = {
  background: 'linear-gradient(180deg,#2c2c2c,#151515)',
  border: '1px solid #050505',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.16), 0 1px 0 rgba(0,0,0,.95)',
};

const FILE_TILE = {
  background: 'linear-gradient(180deg,#2c2c2c,#151515)',
  border: '1px solid #050505',
  boxShadow:
    'inset 0 1px 0 rgba(255,255,255,.16), inset 0 -1px 0 rgba(0,0,0,.65), 0 1px 0 rgba(0,0,0,.95)',
};

// Glyphs keyed by the shared `weatherIcon` vocabulary, so web and phone draw
// the same picture.
const ICONS: Record<WeatherIconKey, LucideIcon> = {
  sun: Sun,
  cloud: Cloud,
  rain: CloudRain,
  storm: CloudLightning,
  snow: CloudSnow,
  fog: CloudFog,
  wind: Wind,
};

function tileRadius(index: number, count: number): string {
  if (count === 1) {
    return '12px';
  }
  const rows = Math.ceil(count / 2);
  const top = Math.floor(index / 2) === 0;
  const bottom = Math.floor(index / 2) === rows - 1;
  const left = index % 2 === 0;
  const corner = (outer: boolean) => (outer ? '12px' : '6px');
  return [
    corner(top && left),
    corner(top && !left),
    corner(bottom && !left),
    corner(bottom && left),
  ].join(' ');
}

export function PlaceBlock({ block }: { block: PlaceBlockData }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">{block.title}</span>
        {block.subtitle !== undefined && (
          <span className="text-[12px] text-[#a1a1a1]">{block.subtitle}</span>
        )}
      </div>
      {block.url !== undefined && (
        <a
          href={block.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[10px] px-[14px] text-[14px] font-medium text-[#ededed]"
          style={BLOCK_KEY}
        >
          <Navigation className="size-3.5" strokeWidth={2} aria-hidden="true" />
          Directions
        </a>
      )}
    </div>
  );
}

export function EventBlock({ block }: { block: EventBlockData }) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const when = eventWhen(block.startAt, block.endAt, timeZone);
  return (
    <div className="flex items-center gap-3">
      <div
        className="flex h-[52px] w-12 shrink-0 flex-col items-center justify-center rounded-[12px]"
        style={EVENT_TILE}
      >
        <span className="font-mono text-[10px] text-[#a1a1a1]">{when.month}</span>
        <span className="font-mono text-[20px] leading-6 font-semibold tabular-nums">
          {when.day}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">{block.title}</span>
        <span className="text-[12px] text-[#a1a1a1]">
          {when.line}
          {block.detail !== undefined && ` · ${block.detail}`}
        </span>
      </div>
    </div>
  );
}

export function FileBlock({ block }: { block: FileBlockData }) {
  const meta = [
    block.size,
    block.format,
    block.rows === undefined ? undefined : `${block.rows} rows`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' · ');
  return (
    <div className="flex items-center gap-3">
      <div
        className="flex size-10 shrink-0 items-center justify-center rounded-[10px]"
        style={FILE_TILE}
      >
        <File className="size-[18px] text-[#d4d4d4]" strokeWidth={1.8} aria-hidden="true" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">{block.name}</span>
        <span className="truncate font-mono text-[11px] text-[#8a8a8a]">{meta}</span>
      </div>
      <a
        href={`/api/card-media/${block.media}`}
        download={block.name}
        aria-label="Download"
        className="flex size-9 shrink-0 items-center justify-center rounded-[10px]"
        style={BLOCK_KEY}
      >
        <Download className="size-4 text-[#d4d4d4]" strokeWidth={2} aria-hidden="true" />
      </a>
    </div>
  );
}

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

/**
 * Uploaded media ids draw as one full-width tile or a 2×2 grid, with `extra`
 * summed on the last tile. The route sends the bytes same-origin, so the
 * session cookie authenticates every `<img>`.
 */
export function ImagesBlock({
  block,
  title,
}: {
  block: ImagesBlockData;
  title?: string | undefined;
}) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const count = block.items.length;
  const label = title ?? 'Image';
  return (
    <div className={count === 1 ? '' : 'grid grid-cols-2 gap-1'}>
      {block.items.map((id, index) => {
        const extra = index === count - 1 ? block.extra : undefined;
        return (
          <a
            key={`${id}-${index}`}
            href={failed.has(id) ? undefined : `/api/card-media/${id}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            className="relative block overflow-hidden bg-[#181818]"
            style={{
              height: count === 1 ? '180px' : '120px',
              borderRadius: tileRadius(index, count),
            }}
          >
            {failed.has(id) ? (
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-muted-foreground">
                <ImageOff className="size-5" aria-hidden />
                <span className="text-[12px]">Photo unavailable</span>
              </span>
            ) : (
              <img
                src={`/api/card-media/${id}`}
                loading="lazy"
                className="size-full object-cover"
                alt=""
                onError={() =>
                  setFailed((current) => {
                    const next = new Set(current);
                    next.add(id);
                    return next;
                  })
                }
              />
            )}
            {extra !== undefined && extra > 0 && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-[20px] font-medium">
                +{extra}
              </span>
            )}
          </a>
        );
      })}
    </div>
  );
}
