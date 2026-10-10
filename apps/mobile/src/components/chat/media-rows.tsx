import { formatDuration, formatShortDate } from '@zilar/chat-core';
import type { ReactNode } from 'react';
import { Image, Pressable, View } from 'react-native';

import { Button } from '../ui/button';
import { Text } from '../ui/text';
import type { MediaItem, MediaTab } from '../../lib/media-api';

/**
 * Human file size, e.g. `512 B`, `2.0 KB`, `5.0 MB`. Shared by the file
 * rows and the media grid's fallback rows; `chat-core` has no size helper.
 */
export function formatMediaSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb < 10 ? kb.toFixed(1) : String(Math.round(kb))} KB`;
  }
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : String(Math.round(mb))} MB`;
}

function rowKey(item: MediaItem): string {
  return `${item.messageId}:${item.linkUrl ?? item.kind}`;
}

/** The grid draws a tile only for a real remote image, never a mock or file. */
function isRemoteImage(item: MediaItem): boolean {
  if (item.kind !== 'image' && item.kind !== 'gif') return false;
  const url = item.url?.toLowerCase();
  return url !== undefined && (url.startsWith('http://') || url.startsWith('https://'));
}

function dateOf(item: MediaItem): string {
  return formatShortDate(new Date(item.at));
}

/** A metadata line joining only the parts the row actually has. */
function metaLine(parts: (string | undefined)[]): string {
  return parts.filter((part): part is string => part !== undefined && part !== '').join(' · ');
}

export function MediaGrid({
  items,
  onShowInChat,
}: {
  items: MediaItem[];
  onShowInChat: (item: MediaItem) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-1 pt-2">
      {items.map((item, index) =>
        isRemoteImage(item) ? (
          <Pressable
            key={`${rowKey(item)}:${index}`}
            accessibilityRole="button"
            accessibilityLabel={`Show ${item.name ?? 'media'} in chat`}
            onPress={() => onShowInChat(item)}
            className="h-24 w-[31%] overflow-hidden rounded-md bg-surface-raised active:opacity-70"
          >
            <Image source={{ uri: item.url ?? '' }} resizeMode="cover" className="h-full w-full" />
          </Pressable>
        ) : (
          <FileRow key={`${rowKey(item)}:${index}`} item={item} onShowInChat={onShowInChat} />
        ),
      )}
    </View>
  );
}

export function MediaRowList({
  tab,
  items,
  onShowInChat,
  onOpenLink,
}: {
  tab: MediaTab;
  items: MediaItem[];
  onShowInChat: (item: MediaItem) => void;
  onOpenLink: (url: string) => void;
}) {
  return (
    <View className="pt-1">
      {items.map((item, index) => {
        if (tab === 'links') {
          return (
            <LinkRow
              key={`${rowKey(item)}:${index}`}
              item={item}
              onShowInChat={onShowInChat}
              onOpenLink={onOpenLink}
            />
          );
        }
        if (tab === 'voice') {
          return (
            <VoiceRow key={`${rowKey(item)}:${index}`} item={item} onShowInChat={onShowInChat} />
          );
        }
        return <FileRow key={`${rowKey(item)}:${index}`} item={item} onShowInChat={onShowInChat} />;
      })}
    </View>
  );
}

/**
 * The shared chrome of the per-tab rows: the left body keeps each row's own
 * texts, and the trailing button is the same for every tab.
 */
function MediaRow({
  item,
  label,
  onShowInChat,
  children,
}: {
  item: MediaItem;
  label: string;
  onShowInChat: (item: MediaItem) => void;
  children: ReactNode;
}) {
  return (
    <View className="flex-row items-center gap-2 border-t border-divider py-2">
      {children}
      <ShowInChatButton item={item} label={label} onShowInChat={onShowInChat} />
    </View>
  );
}

function FileRow({
  item,
  onShowInChat,
}: {
  item: MediaItem;
  onShowInChat: (item: MediaItem) => void;
}) {
  const name = item.name ?? 'File';
  return (
    <MediaRow item={item} label={name} onShowInChat={onShowInChat}>
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[13px] text-foreground">
          {name}
        </Text>
        <Text className="text-[12px] text-muted-foreground">
          {metaLine([
            item.size === undefined ? undefined : formatMediaSize(item.size),
            dateOf(item),
          ])}
        </Text>
      </View>
    </MediaRow>
  );
}

function LinkRow({
  item,
  onShowInChat,
  onOpenLink,
}: {
  item: MediaItem;
  onShowInChat: (item: MediaItem) => void;
  onOpenLink: (url: string) => void;
}) {
  const url = item.linkUrl ?? item.url ?? '';
  const host = item.linkHost ?? url;
  return (
    <MediaRow item={item} label={host} onShowInChat={onShowInChat}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Open ${url}`}
        onPress={() => onOpenLink(url)}
        className="min-w-0 flex-1 active:opacity-70"
      >
        <Text numberOfLines={1} className="text-[13px] font-medium text-foreground">
          {host}
        </Text>
        <Text numberOfLines={1} className="text-[12px] text-muted-foreground">
          {url}
        </Text>
      </Pressable>
    </MediaRow>
  );
}

function VoiceRow({
  item,
  onShowInChat,
}: {
  item: MediaItem;
  onShowInChat: (item: MediaItem) => void;
}) {
  const duration = item.durationMs === undefined ? undefined : formatDuration(item.durationMs);
  return (
    <MediaRow item={item} label="voice message" onShowInChat={onShowInChat}>
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[13px] text-foreground">
          {duration ?? 'Voice message'}
        </Text>
        <Text className="text-[12px] text-muted-foreground">
          {metaLine([item.senderName, dateOf(item)])}
        </Text>
      </View>
    </MediaRow>
  );
}

function ShowInChatButton({
  item,
  label,
  onShowInChat,
}: {
  item: MediaItem;
  label: string;
  onShowInChat: (item: MediaItem) => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      accessibilityLabel={`Show ${label} in chat`}
      onPress={() => onShowInChat(item)}
      className="shrink-0 rounded-full"
    >
      <Text className="text-[13px] font-medium text-accent">Show in chat</Text>
    </Button>
  );
}
