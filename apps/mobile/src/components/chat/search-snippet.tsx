import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { SearchItem } from '@/lib/search-api';
import { snippetParts } from './message-search';

const MARK_BACKGROUND = '#2a2a2a';

// A hit's snippet with its matched ranges highlighted. The snippet is plain server text plus character ranges; every slice renders through nested `Text`, never HTML or a link, so a hostile snippet cannot inject markup or tappable links.
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
            className="rounded-[3px] text-[13px] text-foreground"
            style={{ backgroundColor: MARK_BACKGROUND }}
          >
            {part.text}
          </Text>
        ) : (
          <Text key={index} className="text-[13px] text-muted-foreground">
            {part.text}
          </Text>
        ),
      )}
    </Text>
  );
}

export function SearchHitLine({ item }: { item: SearchItem }) {
  return (
    <View className="mt-0.5 flex-row items-baseline gap-1.5">
      <Text numberOfLines={1} className="shrink-0 text-[13px] text-foreground">
        {item.senderName}
      </Text>
      <View className="min-w-0 flex-1">
        <SearchSnippet snippet={item.snippet} marks={item.marks} />
      </View>
    </View>
  );
}
