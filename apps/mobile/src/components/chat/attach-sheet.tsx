import {
  Camera,
  Paperclip,
  File as FileIcon,
  Image as ImageIcon,
  type LucideIcon,
  FileText,
} from 'lucide-react-native';
import { Effect } from 'effect';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Linking, Modal, Pressable, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { formatDuration } from '@zilar/chat-core';
import type { Attachment } from '@zilar/protocol';
import { useSheetMotion } from '@/components/chat/sheet-motion';
import { Text } from '@/components/ui/text';
import { createGalleryReader } from '@/lib/attachment-picker';
import type {
  GalleryAsset,
  GalleryPage,
  GalleryPickResult,
  GalleryReader,
} from '@/lib/attachment-picker';
import type { PickedFile } from '@/lib/attachment-ports';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { primaryKey, segment } from '@/lib/depth';
import { isWaiting, useAction } from '@/lib/effect/use-action';

/**
 * The File tab: today's document picker behind "Browse files". The
 * Telegram row "Send photos as files" is deliberately absent: the send path
 * takes the kind from the file's MIME (`classifyMobileFile` /
 * `attachmentDataFor`), so a photo cannot be forced to `kind: 'file'` without
 * changing the store's bytes port (`apps/mobile/src/store/effects/ports.ts`).
 */
function FileTab({ busy, onPick }: { busy: boolean; onPick: (choice: AttachmentChoice) => void }) {
  const iconColor = ICON;
  return (
    <View className="pt-1">
      <FileRow
        label="Browse files"
        hint="Any document"
        onPress={() => onPick('file')}
        busy={busy}
        icon={<FileText size={20} color={iconColor} />}
      />
    </View>
  );
}

function FileRow({
  label,
  hint,
  onPress,
  busy,
  icon,
}: {
  label: string;
  hint: string;
  onPress: () => void;
  busy: boolean;
  icon: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      onPress={onPress}
      className="flex-row items-center gap-3 border-b border-divider px-1 py-3.5 active:bg-surface-raised disabled:opacity-60"
    >
      <View className="h-9 w-9 items-center justify-center rounded-[8px] bg-surface-raised">
        {icon}
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[16px] text-foreground">{label}</Text>
        <Text className="text-[13px] text-muted-foreground">{hint}</Text>
      </View>
    </Pressable>
  );
}

/** The two tabs of the attach sheet: the inline gallery and files. */
type AttachTab = 'gallery' | 'file';

const TABS: { id: AttachTab; label: string; Icon: LucideIcon }[] = [
  { id: 'gallery', label: 'Gallery', Icon: ImageIcon },
  { id: 'file', label: 'File', Icon: FileIcon },
];

/**
 * The sheet's bottom tab bar: Gallery | File, lucide icons, and the active
 * pill look of the main floating tab bar (`segment`). The face is keyed by its
 * look, so Android rebuilds it instead of swapping the gradient on a live view.
 */
function AttachTabBar({
  active,
  onSelect,
}: {
  active: AttachTab;
  onSelect: (tab: AttachTab) => void;
}) {
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel="Attachment tabs"
      className="flex-row gap-1 border-t border-divider pt-2"
    >
      {TABS.map(({ id, label, Icon }) => {
        const selected = active === id;
        return (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={() => onSelect(id)}
            className="flex-1 items-center justify-center rounded-[10px] py-1 active:bg-surface-raised"
          >
            <View
              key={selected ? 'active' : 'idle'}
              className="flex-row items-center gap-1.5 rounded-[8px] px-3 py-1.5"
              {...(selected ? { style: segment } : {})}
            >
              <Icon size={16} color={selected ? '#ededed' : ICON} />
              <Text
                className="text-[13px] font-medium"
                style={{ color: selected ? '#ededed' : MUTED_FOREGROUND }}
              >
                {label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export type AttachmentChoice = 'library' | 'camera' | 'file';

type AttachSheetProps = {
  open: boolean;
  busy: boolean;
  error?: string | undefined;
  demoAttachments?: Attachment[] | undefined;
  onPick: (choice: AttachmentChoice) => void;
  onPickDemo?: ((attachment: Attachment) => void) | undefined;
  onSendFiles: (files: PickedFile[]) => void;
  onClose: () => void;
};

export function AttachSheet({ open, onClose, ...props }: AttachSheetProps) {
  if (!open) {
    return null;
  }
  return <AttachSheetBody onClose={onClose} {...props} />;
}

/** Split out so closing unmounts it and clears the tab, selection and gallery page. */
function AttachSheetBody({
  busy,
  error,
  demoAttachments,
  onPick,
  onPickDemo,
  onSendFiles,
  onClose,
}: Omit<AttachSheetProps, 'open'>) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<AttachTab>('gallery');
  const gallery = useGalleryAssets();
  const { panelStyle, onLayout, close, dragGesture } = useSheetMotion(onClose);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      {/* Gestures do not fire inside an RN `Modal` on Android without a root. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Pressable
          accessibilityLabel="Close attachments"
          onPress={close}
          className="flex-1 justify-end bg-black/40"
        >
          <Animated.View className="h-[75%]" onLayout={onLayout} style={panelStyle}>
            <Pressable
              onPress={() => {}}
              accessibilityRole="menu"
              accessibilityLabel="Attach"
              className="flex-1 rounded-t-2xl border-t border-border-strong bg-surface px-4 pt-3"
              style={{ paddingBottom: Math.max(insets.bottom, 8) }}
            >
              <GestureDetector gesture={dragGesture}>
                <View className="py-2">
                  <View className="mb-1 h-1 w-10 self-center rounded-full bg-surface-raised" />
                  <View className="flex-row items-center gap-2 py-2">
                    <Paperclip size={20} color={ICON} />
                    <Text
                      accessibilityRole="header"
                      className="text-[17px] font-semibold text-foreground"
                    >
                      Attach
                    </Text>
                  </View>
                </View>
              </GestureDetector>
              {busy ? (
                <View className="flex-row items-center gap-2 px-1 py-1">
                  <ActivityIndicator accessibilityLabel="Preparing file" />
                  <Text className="text-[13px] text-muted-foreground">Preparing…</Text>
                </View>
              ) : null}
              {error !== undefined && error !== '' ? (
                <Text role="alert" className="px-1 py-1 text-[13px] text-danger">
                  {error}
                </Text>
              ) : null}
              <View className="min-h-0 flex-1">
                {/* The gallery stays mounted while the File tab shows, so its
                  page and the selection survive a tab switch. */}
                <View
                  className="min-h-0 flex-1"
                  style={tab === 'gallery' ? undefined : { display: 'none' }}
                >
                  <GalleryTab
                    gallery={gallery}
                    busy={busy}
                    demoAttachments={demoAttachments}
                    onPick={onPick}
                    onPickDemo={onPickDemo}
                    onSendFiles={onSendFiles}
                  />
                </View>
                {tab === 'file' ? <FileTab busy={busy} onPick={onPick} /> : null}
              </View>
              <AttachTabBar active={tab} onSelect={setTab} />
            </Pressable>
          </Animated.View>
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

const DENIED_MESSAGE = "Zilar can't see your photos.";
const ERROR_MESSAGE = "Couldn't load your photos.";
const STAGE_FAILED_MESSAGE = 'Could not prepare those photos. Try again.';

/**
 * The Gallery tab: the recent-assets grid with the camera tile, multi
 * select and the "Send N" bar that sends the picked files at once, with the
 * composer text as the caption. When the media library is not
 * available it falls back to the mock demo attachments, and a denied permission
 * offers the system settings or the plain gallery picker. Pure view plus
 * selection: the composer owns the send.
 */
function GalleryTab({
  gallery,
  busy,
  demoAttachments,
  onPick,
  onPickDemo,
  onSendFiles,
}: {
  gallery: GalleryAssets;
  busy: boolean;
  demoAttachments?: Attachment[] | undefined;
  onPick: (choice: AttachmentChoice) => void;
  onPickDemo?: ((attachment: Attachment) => void) | undefined;
  onSendFiles: (files: PickedFile[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [stageError, setStageError] = useState<string | undefined>(undefined);
  const [sendState, sendSelected] = useAction((files: readonly GalleryAsset[]) =>
    Effect.tryPromise({
      try: () => gallery.stageAssets(files),
      catch: () => undefined,
    }).pipe(
      Effect.tap((staged) =>
        Effect.sync(() => {
          if (staged === undefined) {
            setStageError(STAGE_FAILED_MESSAGE);
            return;
          }
          if (staged.status === 'error') {
            setStageError(staged.message);
            return;
          }
          if (staged.files.length > 0) {
            onSendFiles(staged.files);
          }
        }),
      ),
    ),
  );
  const staging = isWaiting(sendState);

  const demos = demoAttachments ?? [];
  // Mock mode (or a device with no library): the demo attachments stand in, so
  // the flow still works without a server. The sheet's other rows are gone.
  if (gallery.status !== 'ready' && demos.length > 0 && onPickDemo !== undefined) {
    return <DemoAttachments demos={demos} busy={busy} onPickDemo={onPickDemo} />;
  }
  if (gallery.status === 'loading') {
    return (
      <View className="flex-1 items-center justify-center gap-2">
        <ActivityIndicator accessibilityLabel="Loading photos" />
        <Text className="text-[13px] text-muted-foreground">Loading photos…</Text>
      </View>
    );
  }
  if (gallery.status === 'denied') {
    return (
      <MessageState
        message={DENIED_MESSAGE}
        primary={{ label: 'Open settings', onPress: () => void Linking.openSettings() }}
        secondary={{ label: 'Choose from gallery', onPress: () => onPick('library') }}
      />
    );
  }
  if (gallery.status === 'error') {
    return (
      <MessageState
        message={ERROR_MESSAGE}
        secondary={{ label: 'Choose from gallery', onPress: () => onPick('library') }}
      />
    );
  }

  const toggle = (id: string) => {
    setStageError(undefined);
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  };
  const selectedAssets = selected
    .map((id) => gallery.assets.find((asset) => asset.id === id))
    .filter((asset): asset is GalleryAsset => asset !== undefined);

  const send = () => {
    if (selectedAssets.length === 0 || staging) {
      return;
    }
    setStageError(undefined);
    sendSelected(selectedAssets);
  };

  return (
    <View className="min-h-0 flex-1">
      <GalleryGrid
        assets={gallery.assets}
        selected={selected}
        busy={busy}
        hasMore={gallery.hasMore}
        onToggle={toggle}
        onCamera={() => onPick('camera')}
        onLoadMore={gallery.loadMore}
      />
      {stageError === undefined ? null : (
        <Text role="alert" className="px-1 py-1 text-[13px] text-danger">
          {stageError}
        </Text>
      )}
      {selected.length === 0 ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Send ${selected.length}`}
          disabled={busy || staging}
          onPress={send}
          className="mt-1 items-center justify-center rounded-[10px] py-3 active:opacity-90 disabled:opacity-60"
          style={primaryKey}
        >
          {staging ? (
            <ActivityIndicator accessibilityLabel="Preparing photos" color="#0a0a0a" />
          ) : (
            <Text className="text-[15px] font-semibold" style={{ color: '#0a0a0a' }}>
              Send {selected.length}
            </Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

function MessageState({
  message,
  primary,
  secondary,
}: {
  message: string;
  primary?: { label: string; onPress: () => void } | undefined;
  secondary?: { label: string; onPress: () => void } | undefined;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-6">
      <Text className="text-center text-[15px] text-foreground">{message}</Text>
      {primary === undefined ? null : <StateButton action={primary} primary />}
      {secondary === undefined ? null : <StateButton action={secondary} />}
    </View>
  );
}

function StateButton({
  action,
  primary = false,
}: {
  action: { label: string; onPress: () => void };
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      onPress={action.onPress}
      className="min-w-[160px] items-center justify-center rounded-[10px] px-4 py-2.5 active:opacity-90"
      style={
        primary ? primaryKey : { backgroundColor: 'transparent', borderWidth: 1, borderColor: ICON }
      }
    >
      <Text className="text-[14px] font-semibold" style={{ color: primary ? '#0a0a0a' : ICON }}>
        {action.label}
      </Text>
    </Pressable>
  );
}

function DemoAttachments({
  demos,
  busy,
  onPickDemo,
}: {
  demos: readonly Attachment[];
  busy: boolean;
  onPickDemo: (attachment: Attachment) => void;
}) {
  const iconColor = ICON;
  return (
    <View className="pt-1">
      <Text className="px-1 py-1 text-[13px] font-semibold text-muted-foreground">
        Try one (demo)
      </Text>
      {demos.map((attachment) => (
        <Pressable
          key={attachment.url}
          accessibilityRole="button"
          accessibilityLabel={`Attach demo ${attachment.name}`}
          disabled={busy}
          onPress={() => onPickDemo(attachment)}
          className="flex-row items-center gap-3 px-1 py-2 active:bg-surface-raised disabled:opacity-60"
        >
          <View className="h-9 w-9 items-center justify-center rounded-[8px] bg-surface-raised">
            {attachment.kind === 'image' ? (
              <ImageIcon size={20} color={iconColor} />
            ) : (
              <FileText size={20} color={iconColor} />
            )}
          </View>
          <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] text-foreground">
            {attachment.name}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Assets fetched per page, about one comfortable screen of the 3-column grid. */
const GALLERY_PAGE_SIZE = 60;

/**
 * The Gallery tab's state machine: `loading` while the first page is on its
 * way, `ready` once the grid is shown, `denied` when the user refused the
 * photo permission, `error` when the library read failed. The reader is a seam
 * (the default is the real `expo-media-library` one) and the sort is newest
 * first, so the first tile is the photo the user just took.
 */
type GalleryStatus = 'loading' | 'ready' | 'denied' | 'error';

type GalleryAssets = {
  status: GalleryStatus;
  assets: GalleryAsset[];
  hasMore: boolean;
  loadMore: () => void;
  /**
   * Stages one pick: every selected asset as a `PickedFile` in the order the
   * user picked them, or the first fixed size sentence when any asset is empty
   * or over the cap (the same all-or-nothing rule as the library pick).
   */
  stageAssets: (selected: readonly GalleryAsset[]) => Promise<GalleryStageResult>;
};

/** The result of staging one pick, mirroring the library pick's size failure. */
type GalleryStageResult =
  { status: 'picked'; files: PickedFile[] } | { status: 'error'; message: string };

/** One page read, folded to `undefined` so the hook never propagates a cause. */
function readPage(
  reader: GalleryReader,
  after: string | undefined,
): Effect.Effect<GalleryPage | undefined> {
  return Effect.tryPromise({
    try: () => reader.loadPage({ after, pageSize: GALLERY_PAGE_SIZE }),
    catch: () => undefined,
  }).pipe(Effect.orElseSucceed(() => undefined));
}

/**
 * Reads the recent assets and pages them as the grid scrolls. The request
 * starts on mount (the sheet mounts this only while it is open), so switching
 * from the File tab and back keeps the already-loaded page.
 */
function useGalleryAssets(readerProp?: GalleryReader | undefined): GalleryAssets {
  const reader = useMemo(() => readerProp ?? createGalleryReader(), [readerProp]);
  const [status, setStatus] = useState<GalleryStatus>('loading');
  const [assets, setAssets] = useState<GalleryAsset[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<string | undefined>(undefined);
  const loadingRef = useRef(false);
  const startedRef = useRef(false);

  const loadMore = useCallback(() => {
    if (loadingRef.current) {
      return;
    }
    loadingRef.current = true;
    Effect.runFork(
      readPage(reader, cursorRef.current).pipe(
        Effect.tap((page) =>
          Effect.sync(() => {
            if (page === undefined) {
              // A later page that fails keeps the grid already on screen; only
              // the first page turns into the error state.
              setHasMore(false);
              setStatus((current) => (current === 'ready' ? current : 'error'));
              return;
            }
            cursorRef.current = page.endCursor;
            setAssets((current) => [...current, ...page.assets]);
            setHasMore(page.hasNextPage);
            setStatus('ready');
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            loadingRef.current = false;
          }),
        ),
      ),
    );
  }, [reader]);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    Effect.runFork(
      Effect.tryPromise({
        try: () => reader.requestPermission(),
        catch: () => false,
      }).pipe(
        Effect.orElseSucceed(() => false),
        Effect.tap((granted) =>
          Effect.sync(() => {
            if (granted) {
              loadMore();
            } else {
              setStatus('denied');
            }
          }),
        ),
      ),
    );
  }, [reader, loadMore]);

  const stageAssets = useCallback(
    (selected: readonly GalleryAsset[]) =>
      Effect.runPromise(
        Effect.forEach(selected, (asset) => Effect.promise(() => reader.toPickedFile(asset))).pipe(
          Effect.map((results): GalleryStageResult => {
            const failed = results.find(
              (result): result is Extract<GalleryPickResult, { status: 'error' }> =>
                result.status === 'error',
            );
            if (failed !== undefined) {
              return { status: 'error', message: failed.message };
            }
            return {
              status: 'picked',
              files: results.flatMap((result) => (result.status === 'picked' ? [result.file] : [])),
            };
          }),
        ),
      ),
    [reader],
  );

  return { status, assets, hasMore, loadMore, stageAssets };
}

/** The Gallery tab's 3-column grid: camera tile first, then recent photos and videos, paged as the user scrolls; a video shows its duration and a selected tile its pick-order number. */
function GalleryGrid({
  assets,
  selected,
  busy,
  hasMore,
  onToggle,
  onCamera,
  onLoadMore,
}: {
  assets: readonly GalleryAsset[];
  /** Selected asset ids, in pick order. */
  selected: readonly string[];
  busy: boolean;
  hasMore: boolean;
  onToggle: (id: string) => void;
  onCamera: () => void;
  onLoadMore: () => void;
}) {
  const cells: ({ kind: 'camera' } | { kind: 'asset'; asset: GalleryAsset })[] = [
    { kind: 'camera' },
    ...assets.map((asset) => ({ kind: 'asset' as const, asset })),
  ];
  return (
    <FlatList
      data={cells}
      keyExtractor={(cell) => (cell.kind === 'camera' ? 'camera' : cell.asset.id)}
      numColumns={3}
      onEndReachedThreshold={0.6}
      onEndReached={() => {
        if (hasMore) {
          onLoadMore();
        }
      }}
      contentContainerStyle={{ paddingBottom: 8 }}
      ListFooterComponent={
        hasMore ? (
          <ActivityIndicator accessibilityLabel="Loading more photos" className="py-3" />
        ) : null
      }
      renderItem={({ item }) =>
        item.kind === 'camera' ? (
          <View style={{ width: '33.333%', padding: 1.5 }}>
            <CameraCell busy={busy} onPress={onCamera} />
          </View>
        ) : (
          <View style={{ width: '33.333%', padding: 1.5 }}>
            <AssetCell
              asset={item.asset}
              selectedIndex={selected.indexOf(item.asset.id)}
              onPress={() => onToggle(item.asset.id)}
            />
          </View>
        )
      }
    />
  );
}

function CameraCell({ busy, onPress }: { busy: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Take a photo"
      disabled={busy}
      onPress={onPress}
      style={{ aspectRatio: 1 }}
      className="items-center justify-center rounded-[6px] bg-surface-raised active:opacity-80 disabled:opacity-60"
    >
      <Camera size={28} color={ICON} />
      <Text className="mt-1 text-[12px] text-muted-foreground">Camera</Text>
    </Pressable>
  );
}

function AssetCell({
  asset,
  selectedIndex,
  onPress,
}: {
  asset: GalleryAsset;
  selectedIndex: number;
  onPress: () => void;
}) {
  const selected = selectedIndex >= 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={asset.mediaType === 'video' ? 'Video' : 'Photo'}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{ aspectRatio: 1 }}
      className="overflow-hidden rounded-[6px]"
    >
      <Image
        source={{ uri: asset.uri }}
        contentFit="cover"
        accessibilityLabel={asset.filename}
        style={{ width: '100%', height: '100%' }}
      />
      {asset.mediaType === 'video' && asset.duration > 0 ? (
        <View className="absolute bottom-1 right-1 rounded-[4px] bg-black/60 px-1 py-0.5">
          <Text className="text-[11px] text-white">
            {formatDuration(asset.duration * 1000, { hours: true })}
          </Text>
        </View>
      ) : null}
      <View
        key={selected ? 'on' : 'off'}
        className="absolute right-1 top-1 h-5 w-5 items-center justify-center rounded-full border"
        style={selected ? primaryKey : { borderColor: 'rgba(255,255,255,0.85)' }}
      >
        {selected ? (
          <Text className="text-[11px] font-semibold" style={{ color: '#0a0a0a' }}>
            {selectedIndex + 1}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
