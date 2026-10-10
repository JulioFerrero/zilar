import { Data, Effect } from 'effect';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Attachment } from '@zilar/protocol';

import { Text } from '@/components/ui/text';
import { channelViewerRole, isChannelChat, mayPostInChannel } from '@/lib/channels';
import { mutedUntilFor } from '@/lib/chat-prefs';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import type { ChatSummary, ReplyRef } from '@/lib/types';
import { useChatStore } from '@/store/chat-store-provider';
import type { GifsApi } from '@/lib/gifs-api';
import type { StickersApi } from '@/lib/stickers-api';
import type {
  SendAttachmentOptions,
  SendStickerChoice,
  SendTextOptions,
  SendVoiceRecording,
} from '@/store/types';
import type { PickedFile } from '@/lib/attachment-ports';
import { Composer } from './composer';

/** The store refused the mute change; the bar shows a fixed sentence, never the cause. */
class MuteChangeFailed extends Data.TaggedError('MuteChangeFailed')<{
  readonly reason: unknown;
}> {}

const MUTE_ERROR_TEXT = 'Could not change the mute. Try again.';

type ChannelComposerProps = {
  chat: ChatSummary;
  /** The group id behind the feed row, for the detail-backed role. */
  groupId: string | undefined;
  replyTo?: ReplyRef;
  onCancelReply: () => void;
  onTyping?: () => void;
  onSend: (text: string) => void;
  onSendSticker: (sticker: SendStickerChoice) => void;
  /** Sends a picked file with the composer text as the caption (T-0150). */
  onSendAttachment?: ((file: PickedFile, options?: SendAttachmentOptions) => void) | undefined;
  /** Sends a finished voice recording (T-0154, forwarded to the composer). */
  onSendVoice?: ((recording: SendVoiceRecording, options?: SendTextOptions) => void) | undefined;
  /** The sticker panel's API client (forwarded to the composer). */
  stickersApi?: StickersApi | undefined;
  /** Demo attachments in mock mode, so the flow works without a server. */
  demoAttachments?: Attachment[] | undefined;
  /** The GIF panel's API client (forwarded to the composer). */
  gifsApi?: GifsApi | undefined;
};

/**
 * The channel feed's bottom bar (T-0144), the mobile twin of web's
 * `ChannelComposerBar`: owners/admins see the normal composer — they post.
 * Subscribers see a recessed bar instead: "Only admins can post here" with
 * a Mute / Unmute button (the T-0135 chat pref on the feed row). Posting
 * itself is enforced by the moderated room, not by this bar: a
 * subscriber's send would be refused by ejabberd.
 *
 * The role rides the feed row (`myRole`); the group detail backs it up once
 * loaded. Unknown reads as a subscriber (read-only) until proven otherwise
 * — the safe default. The decision re-reads on every render, so a promoted
 * subscriber gets the composer without a restart.
 */
export function ChannelComposerBar({
  chat,
  groupId,
  replyTo,
  onCancelReply,
  onTyping,
  onSend,
  onSendSticker,
  onSendAttachment,
  onSendVoice,
  stickersApi,
  demoAttachments,
  gifsApi,
}: ChannelComposerProps) {
  const insets = useSafeAreaInsets();
  const currentUserId = useChatStore((state) => state.currentUserId);
  const groupDetail = useChatStore((state) =>
    groupId === undefined ? undefined : state.groupDetail(groupId),
  );
  const setChatPref = useChatStore((state) => state.setChatPref);
  // A second tap while a change is running is dropped (mode 'ignore'), and
  // the previous failure clears as soon as the next try starts.
  const [muteState, changeMute] = useAction((mutedUntil: string | null) =>
    Effect.tryPromise({
      try: () => setChatPref(chat.id, { mutedUntil }),
      catch: (reason) => new MuteChangeFailed({ reason }),
    }),
  );
  const busy = isWaiting(muteState);
  const error = !busy && failureOf(muteState) !== undefined ? MUTE_ERROR_TEXT : '';

  const role = channelViewerRole(chat, groupDetail, currentUserId);
  const canPost = mayPostInChannel(role);

  if (!isChannelChat(chat) || canPost) {
    return (
      <Composer
        title={chat.title}
        onSend={onSend}
        onSendSticker={onSendSticker}
        onSendAttachment={onSendAttachment}
        onSendVoice={onSendVoice}
        stickersApi={stickersApi}
        demoAttachments={demoAttachments}
        gifsApi={gifsApi}
        replyTo={replyTo}
        onCancelReply={onCancelReply}
        onTyping={onTyping}
      />
    );
  }

  // Muted = mute forever; unmuted = clear. The durations live in the chat
  // menu; this bar is the quick toggle.
  const toggleMute = () => {
    changeMute(chat.muted ? null : mutedUntilFor('forever', new Date()));
  };

  return (
    <View className="px-2 pt-1.5" style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
      <View className="flex-row items-center gap-3 rounded-[14px] bg-surface-raised px-4 py-2.5">
        <Text numberOfLines={1} className="min-w-0 flex-1 text-[14px] text-muted-foreground">
          Only admins can post here
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={chat.muted ? 'Unmute' : 'Mute'}
          disabled={busy}
          onPress={toggleMute}
          className="shrink-0 rounded-full px-4 py-1.5 active:bg-surface disabled:opacity-60"
        >
          <Text className="text-[14px] font-medium text-foreground">
            {chat.muted ? 'Unmute' : 'Mute'}
          </Text>
        </Pressable>
      </View>
      {error !== '' ? (
        <Text role="alert" className="mt-1 px-1 text-[12px] text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
