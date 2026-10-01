import { StickerSchema } from '@galena/protocol';
import { ArrowUp, Mic, Paperclip, Smile, Sticker, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EditBar } from '@/components/chat/edit-bar';
import { loadStickerPacks, persistRecent, StickerPanel } from '@/components/chat/sticker-panel';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { useKeyPress } from '@/components/ui/use-key-press';
import { asColorScheme } from '@/lib/color-scheme';
import { ICON } from '@/lib/colors';
import {
  ACCENT_FOREGROUND,
  KEY_PRIMARY_PRESSED_SHADOW,
  pressStyle,
  primaryKey,
  well,
} from '@/lib/depth';
import { RECENTS_STORAGE, readStoredRecents } from '@/lib/stickers-storage';
import type { RecentStickerEntry, StickerChoice, StickerPack } from '@/lib/stickers';
import type { StickerPanelState } from '@/components/chat/sticker-panel';
import type { ReplyRef } from '@/lib/types';
import type { SendStickerChoice } from '@/store/types';
import { useChatStore } from '@/store/chat-store-provider';
import { useColorScheme } from 'nativewind';

const MIN_INPUT_HEIGHT = 36;
const MAX_INPUT_HEIGHT = 132;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function ReplyBar({ reply, onCancel }: { reply: ReplyRef; onCancel: () => void }) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  return (
    <View className="mb-2 flex-row items-stretch overflow-hidden rounded-[10px]" style={well}>
      <View className="w-[3px] bg-[#333333]" />
      <View className="min-w-0 flex-1 px-2.5 py-1.5">
        <Text className="text-[13px] font-semibold text-[#d4d4d4]">
          Reply to {reply.senderName}
        </Text>
        {reply.text !== undefined ? (
          <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
            {reply.text}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel reply"
        onPress={onCancel}
        className="w-9 items-center justify-center active:bg-surface-raised"
      >
        <X size={18} color={ICON[scheme]} />
      </Pressable>
    </View>
  );
}

type ComposerProps = {
  onSend: (text: string) => void;
  onSendSticker: (sticker: SendStickerChoice) => void;
  replyTo?: ReplyRef;
  onCancelReply: () => void;
  onTyping?: () => void;
  /** Used for the `Message <title>` placeholder, like the web composer. */
  title?: string;
  /** Demo packs in mock mode, so the panel works without a server. */
  demoPacks?: StickerPack[];
};

/** Bottom composer: a well with attach, auto-growing input, emoji and mic/send. */
export function Composer({
  onSend,
  onSendSticker,
  replyTo,
  onCancelReply,
  onTyping,
  title,
  demoPacks,
}: ComposerProps) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const insets = useSafeAreaInsets();
  const { pressed, reduceMotion, setPressed } = useKeyPress();
  const editTarget = useChatStore((state) => state.editTarget);
  const cancelEdit = useChatStore((state) => state.cancelEdit);
  const editMessage = useChatStore((state) => state.editMessage);
  // The target message's text is the initial value; the store keeps the live
  // message under the same id, so the bar never goes stale while editing.
  const targetText = useChatStore((state) => {
    const target = state.editTarget;
    if (target === undefined) return undefined;
    return state.messages(target.chatId).find((message) => message.id === target.messageId)?.text;
  });
  const [text, setText] = useState('');
  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);
  // Entering edit mode prefills the input with the message's text; leaving it
  // restores whatever the user had typed before they tapped Edit. The seeding
  // runs while rendering, keyed on the message id (a string), instead of in an
  // effect: a later inbound correction (which only changes `targetText`) does
  // not clobber the user's typing, and no state is set from an effect.
  const editingId =
    editTarget === undefined ? undefined : `${editTarget.chatId}:${editTarget.messageId}`;
  const [seededFor, setSeededFor] = useState<string | undefined>(undefined);
  const [previousDraft, setPreviousDraft] = useState('');
  if (editingId !== seededFor) {
    setSeededFor(editingId);
    if (editingId !== undefined) {
      setPreviousDraft(text);
      setText(targetText ?? '');
    }
  }
  const canSend = text.trim().length > 0;
  const iconColor = ICON[scheme];
  const placeholder = title === undefined ? 'Message' : `Message ${title}`;

  // The sticker panel: the user's packs from the server (demo packs in mock
  // mode), a per-device Recent row, tap-to-send. Loading, error + retry, and
  // the "create on web" empty state live in `StickerPanel`.
  const [panelOpen, setPanelOpen] = useState(false);
  const [packs, setPacks] = useState<StickerPack[] | undefined>(undefined);
  const [panelState, setPanelState] = useState<StickerPanelState>('loading');
  const [recents, setRecents] = useState<RecentStickerEntry[]>([]);
  const [activePackId, setActivePackId] = useState<string | undefined>(undefined);

  const loadPanel = useCallback(() => {
    setActivePackId((current) =>
      current !== undefined && (demoPacks ?? []).some((pack) => pack.id === current)
        ? current
        : undefined,
    );
    if (demoPacks !== undefined) {
      setPacks(demoPacks);
      setPanelState(demoPacks.length === 0 ? 'empty' : 'ready');
      return;
    }
    setPanelState('loading');
    void loadStickerPacks()
      .then((loaded) => {
        setPacks(loaded);
        // A pack deleted on the web leaves a stale tab: reset it so the
        // panel resolves back to Recent or the first pack.
        setActivePackId((current) =>
          current !== undefined && loaded.some((pack) => pack.id === current) ? current : undefined,
        );
        setPanelState(loaded.length === 0 ? 'empty' : 'ready');
      })
      .catch(() => {
        setPanelState('error');
      });
  }, [demoPacks]);

  const openPanel = () => {
    setPanelOpen(true);
    loadPanel();
    void readStoredRecents()
      .then(setRecents)
      .catch(() => {});
  };

  const pickSticker = (sticker: StickerChoice) => {
    setPanelOpen(false);
    // Validate before persisting: a hostile or drifted choice shows the
    // store's error and is never written to Recents.
    const data = {
      pack_id: sticker.packId,
      sticker_id: sticker.stickerId,
      url: sticker.url,
      ...(sticker.emoji === undefined ? {} : { emoji: sticker.emoji }),
      width: sticker.width,
      height: sticker.height,
      mime: sticker.mime,
    };
    if (!StickerSchema.safeParse(data).success) {
      onSendSticker(sticker);
      return;
    }
    void persistRecent(RECENTS_STORAGE, recents, sticker)
      .then(setRecents)
      .catch(() => {});
    onSendSticker(sticker);
  };

  const handleSend = () => {
    if (!canSend) {
      return;
    }
    if (editTarget !== undefined) {
      // XEP-0308: replacing the message with a new body sends a correction.
      // The sender id check and the no-op guard live in the store.
      editMessage(editTarget.chatId, editTarget.messageId, text);
      cancelEdit();
      setPreviousDraft('');
      setText('');
      setInputHeight(MIN_INPUT_HEIGHT);
      return;
    }
    onSend(text);
    setText('');
    setInputHeight(MIN_INPUT_HEIGHT);
  };

  const handleCancelEdit = () => {
    cancelEdit();
    setText(previousDraft);
    setPreviousDraft('');
  };

  const handleChange = (value: string) => {
    setText(value);
    if (editTarget === undefined && value.trim().length > 0) {
      onTyping?.();
    }
  };

  return (
    <View className="px-2 pt-1.5" style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
      {editTarget !== undefined ? (
        <EditBar text={targetText ?? ''} onCancel={handleCancelEdit} />
      ) : replyTo !== undefined ? (
        <ReplyBar reply={replyTo} onCancel={onCancelReply} />
      ) : null}
      <View
        className="flex-row items-end gap-1 rounded-[14px] p-2"
        style={[well, { borderColor: '#262626' }]}
      >
        <IconButton label="Attach file" className="h-9 w-9 rounded-[10px]">
          <Paperclip size={20} color={iconColor} />
        </IconButton>
        <TextInput
          value={text}
          onChangeText={handleChange}
          multiline
          placeholder={placeholder}
          placeholderTextColor="#a1a1a1"
          accessibilityLabel="Message"
          className="mx-1 flex-1 py-2 text-[16px] text-foreground"
          style={{ height: inputHeight, maxHeight: MAX_INPUT_HEIGHT, lineHeight: 20 }}
          onContentSizeChange={(event) =>
            setInputHeight(
              clamp(
                Math.round(event.nativeEvent.contentSize.height) + 16,
                MIN_INPUT_HEIGHT,
                MAX_INPUT_HEIGHT,
              ),
            )
          }
        />
        <IconButton label="Emoji" className="h-9 w-9 rounded-[10px]">
          <Smile size={20} color={iconColor} />
        </IconButton>
        <IconButton label="Stickers" className="h-9 w-9 rounded-[10px]" onPress={openPanel}>
          <Sticker size={20} color={iconColor} />
        </IconButton>
        {canSend ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={editTarget !== undefined ? 'Save edit' : 'Send message'}
            onPress={handleSend}
            onPressIn={() => setPressed(true)}
            onPressOut={() => setPressed(false)}
            className="h-9 w-9 items-center justify-center rounded-[10px]"
            style={[primaryKey, pressStyle(pressed, KEY_PRIMARY_PRESSED_SHADOW, reduceMotion)]}
          >
            <ArrowUp size={20} color={ACCENT_FOREGROUND} />
          </Pressable>
        ) : (
          <IconButton label="Record voice message" className="h-9 w-9 rounded-[10px]">
            <Mic size={20} color={iconColor} />
          </IconButton>
        )}
      </View>
      <StickerPanel
        open={panelOpen}
        packs={packs}
        state={panelState}
        recents={recents}
        activePackId={activePackId}
        onSelectPack={setActivePackId}
        onPick={pickSticker}
        onRetry={loadPanel}
        onClose={() => setPanelOpen(false)}
      />
    </View>
  );
}
