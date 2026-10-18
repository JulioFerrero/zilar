import { Link, Pencil } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { IconTile } from '@/components/ui/icon-tile';
import { ListRow } from '@/components/ui/list-row';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { ICON } from '@/lib/colors';
import { httpsTopicUrl, topicLinkText } from '@/lib/topics';
import type { TopicInfo } from '@zilar/chat-core';
import type { PatchTopicInput } from '@/lib/topics-api';

const LABEL_MAX = 40;

type TopicLinkRowProps = {
  topic: TopicInfo;
  patch: (input: PatchTopicInput) => void;
  onError: (message: string) => void;
};

// The topic's link as an editable row: the label (or host) opens the URL, the pencil edits it, the form keeps the https check and the 40-character label. Without a link the row adds one; an existing one can be removed.
export function TopicLinkRow({ topic, patch, onError }: TopicLinkRowProps) {
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const href = httpsTopicUrl(topic.linkUrl);

  const startEdit = (): void => {
    onError('');
    setUrl(topic.linkUrl ?? '');
    setLabel(topic.linkLabel ?? '');
    setEditing(true);
  };

  const save = (): void => {
    onError('');
    const trimmed = url.trim();
    if (trimmed !== '' && httpsTopicUrl(trimmed) === undefined) {
      onError('Link must be an https URL.');
      return;
    }
    setEditing(false);
    const nextLabel = label.trim() === '' ? null : label.trim().slice(0, LABEL_MAX);
    patch({ linkUrl: trimmed === '' ? null : trimmed, linkLabel: nextLabel });
  };

  const remove = (): void => {
    onError('');
    setEditing(false);
    patch({ linkUrl: null, linkLabel: null });
  };

  if (editing) {
    return (
      <View className="mx-2 gap-2 rounded-xl border border-border-strong p-3">
        <TextField
          value={url}
          onChangeText={setUrl}
          placeholder="https://…"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Topic link URL"
          className="text-[13px]"
        />
        <TextField
          value={label}
          onChangeText={setLabel}
          placeholder="Label (optional)"
          maxLength={LABEL_MAX}
          accessibilityLabel="Topic link label"
          className="text-[13px]"
        />
        <View className="flex-row items-center justify-end gap-1.5">
          {href === undefined ? null : (
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto"
              accessibilityLabel="Remove topic link"
              onPress={remove}
            >
              <Text>Remove</Text>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            accessibilityLabel="Cancel link edit"
            onPress={() => setEditing(false)}
          >
            <Text>Cancel</Text>
          </Button>
          <Button size="sm" accessibilityLabel="Save link" onPress={save}>
            <Text>Save</Text>
          </Button>
        </View>
      </View>
    );
  }

  if (href === undefined) {
    return (
      <ListRow
        icon={
          <IconTile>
            <Link size={16} color={ICON} />
          </IconTile>
        }
        title="Add a link"
        chevron={false}
        onPress={startEdit}
      />
    );
  }

  return (
    <View className="flex-row items-center gap-1">
      <View className="min-w-0 flex-1">
        <ListRow
          icon={
            <IconTile>
              <Link size={16} color={ICON} />
            </IconTile>
          }
          title={topicLinkText(topic)}
          chevron={false}
          accessibilityLabel={`Open ${topicLinkText(topic)}`}
          onPress={() => {
            void Linking.openURL(href);
          }}
        />
      </View>
      <IconButton label="Edit topic link" className="mr-1" onPress={startEdit}>
        <Pencil size={16} color={ICON} />
      </IconButton>
    </View>
  );
}
