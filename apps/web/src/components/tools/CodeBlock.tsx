import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Plain text with line numbers for read-only code and output (T-0107).
 * Renders as text only — string content can never become an element, so
 * `<img onerror>` and `javascript:` strings from tool source or output
 * stay inert. No syntax-highlighter dependency, per the spec.
 */
export function CodeBlock({ code, label }: { code: string; label: string }) {
  const lines = code.split('\n');
  return (
    <pre
      aria-label={label}
      className="well-surface overflow-x-auto rounded-[10px] p-3 font-mono text-[12.5px] leading-5 text-foreground"
    >
      <code>
        {lines.map((line, index) => (
          <span key={index} className="block">
            <span
              aria-hidden="true"
              className="mr-3 inline-block w-8 shrink-0 text-right text-subtle-foreground select-none"
            >
              {index + 1}
            </span>
            <span>{line === '' ? ' ' : line}</span>
            {index < lines.length - 1 ? '\n' : ''}
          </span>
        ))}
      </code>
    </pre>
  );
}

/**
 * Long plain-text output truncated with a "Show all" toggle (T-0107).
 * Renders as text, never HTML.
 */
export function TruncatedText({
  text,
  preview,
  truncated,
}: {
  text: string;
  preview: string;
  truncated: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded || !truncated ? text : preview;
  return (
    <div className="flex flex-col gap-1">
      <pre className="well-surface overflow-x-auto rounded-[10px] p-3 font-mono text-[12.5px] leading-5 whitespace-pre-wrap text-foreground">
        {shown}
      </pre>
      {truncated && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start text-muted-foreground"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show less' : 'Show all'}
        </Button>
      )}
    </div>
  );
}
