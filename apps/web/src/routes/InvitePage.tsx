import { useParams } from 'react-router';
import { AuthFlow } from '@/components/auth/AuthFlow';

export function InvitePage() {
  // A missing code is undefined, so the invite step starts with an empty field.
  const { code } = useParams<{ code: string }>();
  return <AuthFlow inviteCode={code} heading="You're invited to Zilar" />;
}
