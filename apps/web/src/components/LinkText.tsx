import {
  isMentionOfMe,
  parseLightInline,
  splitCodeBlocks,
  splitLinks,
  splitMentions,
  type UiMention,
} from '@zilar/chat-core';

/**
 * Renders message text: http/https URLs become safe external links and XEP-0372
 * mention ranges become chips. A mention of the current user (an exact bare-JID
 * match) gets the raised look so it stands out. With `formatted`, the light
 * Markdown subset also applies: **bold**, *italics*, `inline code` and fenced
 * code blocks (the code uses the `.md` look from `index.css:441-471`, inlined
 * as Tailwind classes so no stylesheet change is needed), with no links or
 * mentions inside code.
 */
export function LinkText({
  text,
  mentions,
  meJid,
  formatted = false,
}: {
  text: string;
  mentions?: UiMention[] | undefined;
  meJid?: string | undefined;
  formatted?: boolean | undefined;
}) {
  if (!formatted) {
    return <>{renderPlain(text, mentions, meJid, '')}</>;
  }

  return (
    <>
      {splitCodeBlocks(text).map((block, index) => {
        if (block.kind === 'code') {
          return (
            <pre
              key={index}
              className="my-1 max-w-full overflow-x-auto rounded-[10px] border border-border bg-well p-3 font-mono text-[12.5px] leading-5 whitespace-pre text-foreground shadow-[inset_0_2px_6px_rgba(0,0,0,0.9),inset_0_1px_1px_rgba(0,0,0,0.8),inset_0_0_0_1px_rgba(0,0,0,0.4),0_1px_0_rgba(255,255,255,0.06)]"
            >
              <code>{block.text}</code>
            </pre>
          );
        }
        const shifted = (mentions ?? []).map((mention) => ({
          ...mention,
          begin: mention.begin - block.start,
          end: mention.end - block.start,
        }));
        return renderFormatted(block.text, shifted, meJid, `${index}`);
      })}
    </>
  );
}

function renderPlain(
  text: string,
  mentions: UiMention[] | undefined,
  meJid: string | undefined,
  keyPrefix: string,
) {
  return splitMentions(text, mentions).map((segment, index) => {
    if (segment.kind === 'mention') {
      const mine = isMentionOfMe(segment.jid, meJid);
      return (
        <span
          key={`${keyPrefix}-${index}`}
          className={mine ? 'raised-pill mention-me' : 'mention-chip'}
        >
          {segment.text}
        </span>
      );
    }
    return splitLinks(segment.text).map((linkSegment, linkIndex) =>
      linkSegment.kind === 'link' ? (
        <a
          key={`${keyPrefix}-${index}-${linkIndex}`}
          href={linkSegment.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline-offset-2 hover:underline"
        >
          {linkSegment.text}
        </a>
      ) : (
        <span key={`${keyPrefix}-${index}-${linkIndex}`}>{linkSegment.text}</span>
      ),
    );
  });
}

function renderFormatted(
  text: string,
  mentions: UiMention[],
  meJid: string | undefined,
  keyPrefix: string,
) {
  return splitMentions(text, mentions).map((segment, index) => {
    if (segment.kind === 'mention') {
      const mine = isMentionOfMe(segment.jid, meJid);
      return (
        <span
          key={`${keyPrefix}-${index}`}
          className={mine ? 'raised-pill mention-me' : 'mention-chip'}
        >
          {segment.text}
        </span>
      );
    }
    return splitLinks(segment.text).map((linkSegment, linkIndex) =>
      linkSegment.kind === 'link' ? (
        <a
          key={`${keyPrefix}-${index}-${linkIndex}`}
          href={linkSegment.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline-offset-2 hover:underline"
        >
          {linkSegment.text}
        </a>
      ) : (
        <span key={`${keyPrefix}-${index}-${linkIndex}`}>
          {parseLightInline(linkSegment.text).map((inline, inlineIndex) =>
            inline.kind === 'bold' ? (
              <strong key={inlineIndex}>{inline.text}</strong>
            ) : inline.kind === 'italic' ? (
              <em key={inlineIndex}>{inline.text}</em>
            ) : inline.kind === 'code' ? (
              <code
                key={inlineIndex}
                className="rounded-[4px] border border-edge bg-well px-1 font-mono text-[12.5px]"
              >
                {inline.text}
              </code>
            ) : (
              <span key={inlineIndex}>{inline.text}</span>
            ),
          )}
        </span>
      ),
    );
  });
}
