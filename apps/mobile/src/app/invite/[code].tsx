import { useLocalSearchParams } from 'expo-router';

import { AuthFlow } from '@/auth/AuthFlow';

export default function InviteRoute() {
  // A missing code is `undefined`, so the invite step starts with an empty field.
  const params = useLocalSearchParams<{ code?: string }>();
  const code = typeof params.code === 'string' ? params.code : undefined;
  return <AuthFlow inviteCode={code} heading="You're invited to Zilar" />;
}
