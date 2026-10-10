import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthFlow } from '@/auth/AuthFlow';
import { Text } from '@/components/ui/text';
import { CHAT_BACKGROUND } from '@/lib/colors';
import { API_URL } from '@/lib/auth';
import { checkInvite } from '@/lib/auth-api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { useQuery } from '@/lib/effect/use-query';

type InviteState = 'checking' | 'valid' | 'invalid';

/** A failed check reads as an invalid invite, like an answer of "not valid". */
function inviteStateOf(check: AsyncResult.AsyncResult<boolean, ApiFailure>): InviteState {
  if (AsyncResult.isSuccess(check)) {
    return check.value ? 'valid' : 'invalid';
  }
  return AsyncResult.isFailure(check) ? 'invalid' : 'checking';
}

export default function InviteRoute() {
  const params = useLocalSearchParams<{ code?: string }>();
  const code = typeof params.code === 'string' ? params.code : undefined;
  const [check] = useQuery(
    () => (code === undefined ? Effect.succeed(false) : fromApi(() => checkInvite(API_URL, code))),
    [code],
  );
  const state = code === undefined ? 'invalid' : inviteStateOf(check);

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
  return (
    <View className="flex-1">
      <LinearGradient
        colors={CHAT_BACKGROUND}
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
