import { splitLinks } from '@galena/chat-core';

/** Renders message text, turning http/https URLs into safe external links. */
export function LinkText({ text }: { text: string }) {
  const segments = splitLinks(text);

  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'link' ? (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline-offset-2 hover:underline"
          >
            {segment.text}
          </a>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
