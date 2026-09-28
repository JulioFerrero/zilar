import { isMentionOfMe, splitLinks, splitMentions, type UiMention } from '@galena/chat-core';

/**
 * Renders message text: http/https URLs become safe external links and XEP-0372
 * mention ranges become chips. A mention of the current user (an exact bare-JID
 * match) gets the raised look so it stands out.
 */
export function LinkText({
  text,
  mentions,
  meJid,
}: {
  text: string;
  mentions?: UiMention[] | undefined;
  meJid?: string | undefined;
}) {
  const segments = splitMentions(text, mentions);

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === 'mention') {
          const mine = isMentionOfMe(segment.jid, meJid);
          return (
            <span key={index} className={mine ? 'raised-pill mention-me' : 'mention-chip'}>
              {segment.text}
            </span>
          );
        }
        return splitLinks(segment.text).map((linkSegment, linkIndex) =>
          linkSegment.kind === 'link' ? (
            <a
              key={`${index}-${linkIndex}`}
              href={linkSegment.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline-offset-2 hover:underline"
            >
              {linkSegment.text}
            </a>
          ) : (
            <span key={`${index}-${linkIndex}`}>{linkSegment.text}</span>
          ),
        );
      })}
    </>
  );
}
