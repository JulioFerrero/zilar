import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { SearchItem } from '@/lib/search-api';
import { snippetParts } from './message-search';

// The snippet's mark color: the accent at rest, like web's `<mark>` wash.
const MARK_BACKGROUND = '#2a2a2a';

/**
 * One message hit's snippet with its matched ranges highlighted. The snippet
 * is plain text from the server (plus character ranges); every slice renders
 * through nested `Text`, never through HTML or a link, so a hostile snippet
 * cannot inject markup or tappable links.
 */
export function SearchSnippet({
  snippet,
  marks,
}: {
  snippet: string;
  marks: Array<[number, number]>;
}) {
  const parts = snippetParts(snippet, marks);
  return (
    <Text numberOfLines={2} className="text-[13px] text-muted-foreground">
      {parts.map((part, index) =>
        part.mark ? (
          <Text
            key={index}
            className="rounded-[3px] text-foreground"
            style={{ backgroundColor: MARK_BACKGROUND }}
          >
            {part.text}
          </Text>
        ) : (
          <Text key={index}>{part.text}</Text>
        ),
      )}
    </Text>
  );
}

/** The sender + time + snippet line under a hit's chat heading. */
export function SearchHitLine({ item }: { item: SearchItem }) {
  return (
    <View className="mt-0.5 flex-row items-baseline gap-1.5">
      <Text numberOfLines={1} className="shrink-0 text-[13px] text-[#d4d4d4]">
        {item.senderName}
      </Text>
      <View className="min-w-0 flex-1">
        <SearchSnippet snippet={item.snippet} marks={item.marks} />
      </View>
    </View>
  );
}
