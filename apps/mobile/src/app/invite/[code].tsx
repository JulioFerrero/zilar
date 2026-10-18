import { useLocalSearchParams } from 'expo-router';

import { AuthFlow } from '@/auth/AuthFlow';

export default function InviteRoute() {
  const params = useLocalSearchParams<{ code?: string }>();
  const code = typeof params.code === 'string' ? params.code : undefined;
  return <AuthFlow inviteCode={code} heading="You're invited to Zilar" />;
}
