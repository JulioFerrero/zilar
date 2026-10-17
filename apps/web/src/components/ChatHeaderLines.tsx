import type { ChatSummary } from '@zilar/chat-core';
import { Globe, Lock } from 'lucide-react';
import { AiBadge } from './AiBadge';
import { TypingDots } from './TypingDots';
import { TopicPeopleLine } from './topic/TopicPeopleLine';

/** The header's first line: the title with its AI, public and private badges. */
export function ChatHeaderTitle({ chat, isTopic }: { chat: ChatSummary; isTopic: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="truncate text-[15px] leading-5 font-semibold">{chat.title}</span>
      {chat.isAI && <AiBadge />}
      {chat.visibility === 'public' && (
        <Globe role="img" aria-label="Public" className="size-3.5 text-muted-foreground" />
      )}
      {isTopic && chat.topic?.visibility === 'private' && (
        <Lock role="img" aria-label="Private" className="size-3.5 text-muted-foreground" />
      )}
    </div>
  );
}

/**
 * The header's second line: a topic's people line, or the subtitle with the
 * typing dots. T-1779 (W1): a topic swaps the old subtitle for the people stack
 * and, while someone writes, the writers with the pulsing dot. The connection
 * line and an AI status line win, exactly as before.
 */
export function ChatHeaderSubtitle({
  chat,
  isTopic,
  names,
  groupTitle,
  onOpen,
  connection,
  aiLine,
  subtitle,
  showTypingDots,
}: {
  chat: ChatSummary;
  isTopic: boolean;
  names: readonly string[];
  groupTitle: string | undefined;
  onOpen: (() => void) | undefined;
  connection: string | undefined;
  aiLine: string | undefined;
  subtitle: string;
  showTypingDots: boolean;
}) {
  if (isTopic && connection === undefined && aiLine === undefined) {
    return <TopicPeopleLine chat={chat} groupTitle={groupTitle} names={names} onOpen={onOpen} />;
  }
  return (
    <div
      role="status"
      className="flex items-center gap-1 text-[12px] leading-4 text-muted-foreground"
    >
      <span className="truncate">{subtitle}</span>
      {showTypingDots && <TypingDots />}
    </div>
  );
}
