import { ArrowUpRight, Eye, EyeOff, Lock } from 'lucide-react-native';
import { Linking, Pressable, View } from 'react-native';

import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';

import type { NewAiFlow } from './use-new-ai-flow';

/**
 * Step 2 (PhoneKey.dc.html): one well field with a lock, a green dot once the
 * key works, a show toggle and "Get one". A provider with a saved connection
 * starts verified, so Continue needs no typing.
 */
export function KeyStep({ flow }: { flow: NewAiFlow }) {
  const pageUrl = flow.keyPageUrl;
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
          value={flow.keyValue}
          onChangeText={flow.setKeyValue}
          accessibilityLabel="API key"
          placeholder={flow.keyPlaceholder}
          secureTextEntry={!flow.showKey}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={16384}
          className="min-w-0 flex-1 border-0 bg-transparent px-0"
        />
        {flow.keyVerified ? <View className="h-2 w-2 rounded-full bg-online" /> : null}
        <IconButton
          label={flow.showKey ? 'Hide key' : 'Show key'}
          className="h-9 w-9 rounded-full"
          onPress={flow.toggleShowKey}
        >
          {flow.showKey ? <EyeOff size={16} color={ICON} /> : <Eye size={16} color={ICON} />}
        </IconButton>
      </View>

      {flow.keyMessage !== '' ? (
        <Text accessibilityRole="alert" className="text-[13px] text-danger">
          {flow.keyMessage}
        </Text>
      ) : null}
    </View>
  );
}
