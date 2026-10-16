import { EMOJI_BY_CATEGORY, EMOJI_CATEGORIES, EMOJI_NAMES, searchEmoji } from '@zilar/chat-core';
import { useMemo, useState } from 'react';
import { SearchField } from '@/components/ui/search-field';

/** Every glyph of every category, in category order; the search corpus. */
const ALL_EMOJI: readonly string[] = Object.values(EMOJI_BY_CATEGORY).flat();

/**
 * WUX-26: the Emoji tab of the sticker panel. A search box filters the shared
 * glyph table by name (e.g. "heart" finds ❤️), and when the box is empty the
 * glyphs are grouped under one header per category.
 */
export function EmojiTab({ onEmoji }: { onEmoji: (emoji: string) => void }) {
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const results = useMemo(() => searchEmoji(query, ALL_EMOJI), [query]);

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
        {searching ? (
          results.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted-foreground">No emoji found.</p>
          ) : (
            <EmojiGrid glyphs={results} onEmoji={onEmoji} />
          )
        ) : (
          EMOJI_CATEGORIES.map((category) => {
            const glyphs = EMOJI_BY_CATEGORY[category.id];
            if (glyphs.length === 0) {
              return null;
            }
            return (
              <section key={category.id} aria-label={category.label} className="pb-1">
                <p className="px-1 pt-1 pb-1.5 text-[12px] font-semibold text-subtle-foreground">
                  {category.label}
                </p>
                <EmojiGrid glyphs={glyphs} onEmoji={onEmoji} />
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

/** The button label and title: the first two words of the glyph's name. */
function emojiLabel(glyph: string): string {
  const name = EMOJI_NAMES[glyph] ?? glyph;
  return name.split(' ').slice(0, 2).join(' ');
}

function EmojiGrid({
  glyphs,
  onEmoji,
}: {
  glyphs: readonly string[];
  onEmoji: (emoji: string) => void;
}) {
  return (
    <div className="grid grid-cols-6 gap-1">
      {glyphs.map((glyph) => {
        const label = emojiLabel(glyph);
        return (
          <button
            key={glyph}
            type="button"
            aria-label={`Insert ${glyph} (${label})`}
            title={label}
            onClick={() => onEmoji(glyph)}
            className="flex h-[48px] items-center justify-center rounded-[8px] text-[26px] hover:bg-surface-raised"
          >
            {glyph}
          </button>
        );
      })}
    </div>
  );
}
