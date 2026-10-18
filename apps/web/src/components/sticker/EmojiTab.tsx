import { EMOJI_BY_CATEGORY, EMOJI_CATEGORIES, EMOJI_NAMES, searchEmoji } from '@zilar/chat-core';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SearchField } from '@/components/ui/search-field';
import { readEmojiRecents, rememberEmojiRecent } from '@/lib/emojiRecents';
import { EmojiCategoryBar, type EmojiSectionId } from './EmojiCategoryBar';
import { panelStorage } from './StickerThumb';

const ALL_EMOJI: readonly string[] = Object.values(EMOJI_BY_CATEGORY).flat();

interface EmojiSection {
  id: EmojiSectionId;
  label: string;
  glyphs: readonly string[];
}

export function EmojiTab({ onEmoji }: { onEmoji: (emoji: string) => void }) {
  // Read once on mount: a pick must not reorder the list under the pointer.
  const [recents] = useState<string[]>(() => readEmojiRecents(panelStorage()));
  const [activeId, setActiveId] = useState<EmojiSectionId>(
    recents.length > 0 ? 'recent' : 'smileys',
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const results = useMemo(() => searchEmoji(query, ALL_EMOJI), [query]);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef(new Map<EmojiSectionId, HTMLElement>());
  const searchRowRef = useRef<HTMLDivElement>(null);
  const jumpTargetRef = useRef<number | null>(null);

  useEffect(() => {
    if (searchOpen) {
      searchRowRef.current?.querySelector('input')?.focus();
    }
  }, [searchOpen]);

  const sections = useMemo<EmojiSection[]>(() => {
    const list: EmojiSection[] = [];
    if (recents.length > 0) {
      list.push({ id: 'recent', label: 'Recently used', glyphs: recents });
    }
    for (const category of EMOJI_CATEGORIES) {
      const glyphs = EMOJI_BY_CATEGORY[category.id];
      if (glyphs.length > 0) {
        list.push({ id: category.id, label: category.label, glyphs });
      }
    }
    return list;
  }, [recents]);

  const followScroll = (): void => {
    const scroller = scrollerRef.current;
    if (scroller === null || sections.length === 0) {
      return;
    }
    const target = jumpTargetRef.current;
    if (target !== null) {
      // `scrollend` is missing on older Safari and on an instant `auto` scroll under
      // reduced motion, so a jump must also release itself here once the scroller
      // reaches the target; otherwise the clicked key stays active for good.
      if (Math.abs(scroller.scrollTop - target) >= 2) {
        return;
      }
      jumpTargetRef.current = null;
    }
    const last = sections[sections.length - 1];
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
      if (last !== undefined) {
        setActiveId(last.id);
      }
      return;
    }
    const top = scroller.getBoundingClientRect().top + 1;
    let current = sections[0]?.id;
    for (const section of sections) {
      const element = sectionRefs.current.get(section.id);
      if (element !== undefined && element.getBoundingClientRect().top <= top) {
        current = section.id;
      }
    }
    if (current !== undefined) {
      setActiveId(current);
    }
  };

  const jumpTo = (id: EmojiSectionId): void => {
    const scroller = scrollerRef.current;
    const section = sectionRefs.current.get(id);
    if (scroller === null || section === undefined) {
      return;
    }
    setActiveId(id);
    const top =
      scroller.scrollTop +
      section.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top;
    const maxTop = scroller.scrollHeight - scroller.clientHeight;
    const target = Math.min(Math.max(top, 0), maxTop);
    jumpTargetRef.current = Math.abs(scroller.scrollTop - target) < 1 ? null : target;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({ top: target, behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  const settleJump = (): void => {
    if (jumpTargetRef.current === null) {
      return;
    }
    jumpTargetRef.current = null;
    followScroll();
  };

  const pick = (glyph: string): void => {
    onEmoji(glyph);
    rememberEmojiRecent(panelStorage(), glyph);
  };

  const closeSearch = (): void => {
    setQuery('');
    setSearchOpen(false);
  };

  return (
    <div className="flex flex-col">
      <div className="flex h-12 items-center px-3">
        {searchOpen ? (
          <div ref={searchRowRef} className="flex w-full items-center gap-1">
            <button
              type="button"
              aria-label="Close search"
              onClick={closeSearch}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </button>
            <SearchField
              className="min-w-0 flex-1 [&_input]:h-8 [&_input]:py-0"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  closeSearch();
                }
              }}
              placeholder="Search emoji"
              aria-label="Search emoji"
            />
          </div>
        ) : (
          <div className="w-full">
            <EmojiCategoryBar
              active={activeId}
              showRecent={recents.length > 0}
              onSelect={jumpTo}
              onOpenSearch={() => setSearchOpen(true)}
            />
          </div>
        )}
      </div>
      <div
        ref={scrollerRef}
        onScroll={followScroll}
        onScrollEnd={settleJump}
        className="h-[300px] overflow-y-auto px-3 pb-2"
        role="group"
        aria-label="Emoji"
      >
        {searching ? (
          results.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted-foreground">No emoji found.</p>
          ) : (
            <EmojiGrid glyphs={results} onEmoji={pick} />
          )
        ) : (
          sections.map((section) => (
            <section
              key={section.id}
              ref={(element) => {
                if (element === null) {
                  sectionRefs.current.delete(section.id);
                } else {
                  sectionRefs.current.set(section.id, element);
                }
              }}
              aria-label={section.label}
            >
              <h3 className="sticky top-0 z-[1] -mx-3 bg-surface px-3 py-1.5 text-[12px] font-semibold text-subtle-foreground">
                {section.label}
              </h3>
              <EmojiGrid glyphs={section.glyphs} onEmoji={pick} />
            </section>
          ))
        )}
      </div>
    </div>
  );
}

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
    <div className="grid grid-cols-8 gap-0.5">
      {glyphs.map((glyph) => {
        const label = emojiLabel(glyph);
        return (
          <button
            key={glyph}
            type="button"
            aria-label={`Insert ${glyph} (${label})`}
            title={label}
            onClick={() => onEmoji(glyph)}
            className="flex h-9 w-9 items-center justify-center justify-self-center rounded-[8px] text-[24px] hover:bg-surface-raised"
          >
            {glyph}
          </button>
        );
      })}
    </div>
  );
}
