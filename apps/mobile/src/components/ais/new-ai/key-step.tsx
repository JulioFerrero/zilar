import { ArrowUpRight, Eye, EyeOff, Lock } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';

import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';

import type { KeyCheck } from '@/components/connections/use-key-check';

export function KeyStep({ keys }: { keys: KeyCheck }) {
  const [showKey, setShowKey] = useState(false);
  const pageUrl = keys.keyPage;
  return (
    <View className="gap-2">
      <View className="flex-row items-center">
        <Text className="flex-1 text-[13px] font-medium text-foreground">API key</Text>
        {pageUrl !== null ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Get a key"
            onPress={() => void Linking.openURL(pageUrl)}
            className="min-h-8 flex-row items-center gap-1 active:opacity-70"
          >
            <Text className="text-[13px] text-muted-foreground">Get one</Text>
            <ArrowUpRight size={12} color={MUTED_FOREGROUND} />
          </Pressable>
        ) : null}
      </View>

      <View className="flex-row items-center gap-2 rounded-[10px] border border-border-strong bg-well px-3">
        <Lock size={15} color={MUTED_FOREGROUND} />
        <TextField
          value={keys.key}
          onChangeText={keys.setKey}
          accessibilityLabel="API key"
          placeholder={keys.keyPlaceholder}
          secureTextEntry={!showKey}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={16384}
          className="min-w-0 flex-1 border-0 bg-transparent px-0"
        />
        {keys.keyVerified ? <View className="h-2 w-2 rounded-full bg-online" /> : null}
        <IconButton
          label={showKey ? 'Hide key' : 'Show key'}
          className="h-9 w-9 rounded-full"
          onPress={() => setShowKey((value) => !value)}
        >
          {showKey ? <EyeOff size={16} color={ICON} /> : <Eye size={16} color={ICON} />}
        </IconButton>
      </View>

      {keys.keyError !== '' ? (
        <Text accessibilityRole="alert" className="text-[13px] text-danger">
          {keys.keyError}
        </Text>
      ) : null}
    </View>
  );
}
