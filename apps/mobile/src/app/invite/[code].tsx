import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthFlow } from '@/auth/AuthFlow';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { CHAT_BACKGROUND } from '@/lib/colors';
import { API_URL } from '@/lib/auth';
import { checkInvite } from '@/lib/auth-api';

type InviteState = 'checking' | 'valid' | 'invalid';

export default function InviteRoute() {
  const params = useLocalSearchParams<{ code?: string }>();
  const code = typeof params.code === 'string' ? params.code : undefined;
  const [state, setState] = useState<InviteState>(code === undefined ? 'invalid' : 'checking');

  useEffect(() => {
    if (code === undefined) {
      return;
    }
    let active = true;
    checkInvite(API_URL, code)
      .then((valid) => {
        if (active) {
          setState(valid ? 'valid' : 'invalid');
        }
      })
      .catch(() => {
        if (active) {
          setState('invalid');
        }
      });
    return () => {
      active = false;
    };
  }, [code]);

  if (state === 'checking') {
    return <InviteMessage title="Checking your invite…" />;
  }
  if (state === 'invalid' || code === undefined) {
    return (
      <InviteMessage
        title="Invite not valid"
        body="This invite link has expired or was already used. Ask your friend for a new one."
      />
    );
  }
  return <AuthFlow inviteCode={code} heading="You're invited to Zilar" />;
}

function InviteMessage({ title, body }: { title: string; body?: string }) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  return (
    <View className="flex-1">
      <LinearGradient
        colors={CHAT_BACKGROUND[scheme]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
      />
      <SafeAreaView className="flex-1 items-center justify-center p-4">
        <View className="w-full max-w-sm rounded-2xl bg-background p-6 shadow-xl">
          <Text className="text-center text-[24px] font-semibold leading-8 text-foreground">
            {title}
          </Text>
          {body !== undefined && (
            <Text className="mt-2 text-center text-[15px] text-muted-foreground">{body}</Text>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}
