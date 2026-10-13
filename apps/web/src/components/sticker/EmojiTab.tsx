import { useMemo, useState } from 'react';
import { SearchField } from '@/components/ui/search-field';
import { EMOJI, EMOJI_CATEGORIES, type EmojiEntry } from './emoji';

/**
 * WUX-26: the Emoji tab of the sticker panel. A search box filters the local
 * list by name (e.g. "heart" finds ❤️), and when the box is empty the glyphs
 * are grouped under one header per category.
 */
export function EmojiTab({ onEmoji }: { onEmoji: (emoji: string) => void }) {
  const [query, setQuery] = useState('');
  const trimmed = query.trim().toLowerCase();
  const results = useMemo(
    () =>
      trimmed === ''
        ? undefined
        : EMOJI.filter((entry) => entry.name.includes(trimmed) || entry.emoji === trimmed),
    [trimmed],
  );

  return (
    <div className="flex flex-col">
      <div className="border-b border-edge p-2">
        <SearchField
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search emoji"
          aria-label="Search emoji"
        />
      </div>
      <div className="max-h-[260px] overflow-y-auto p-2" role="group" aria-label="Emoji">
        {results !== undefined ? (
          results.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted-foreground">No emoji found.</p>
          ) : (
            <EmojiGrid entries={results} onEmoji={onEmoji} />
          )
        ) : (
          EMOJI_CATEGORIES.map((category) => {
            const entries = EMOJI.filter((entry) => entry.category === category.id);
            if (entries.length === 0) {
              return null;
            }
            return (
              <section key={category.id} aria-label={category.label} className="pb-1">
                <p className="px-1 pt-1 pb-1.5 text-[12px] font-semibold text-subtle-foreground">
                  {category.label}
                </p>
                <EmojiGrid entries={entries} onEmoji={onEmoji} />
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

function EmojiGrid({
  entries,
  onEmoji,
}: {
  entries: readonly EmojiEntry[];
  onEmoji: (emoji: string) => void;
}) {
  return (
    <div className="grid grid-cols-6 gap-1">
      {entries.map((entry) => (
        <button
          key={entry.emoji}
          type="button"
          aria-label={`Insert ${entry.emoji} (${entry.name})`}
          title={entry.name}
          onClick={() => onEmoji(entry.emoji)}
          className="flex h-[48px] items-center justify-center rounded-[8px] text-[26px] hover:bg-surface-raised"
        >
          {entry.emoji}
        </button>
      ))}
    </div>
  );
}
