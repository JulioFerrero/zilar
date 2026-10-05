import { NameForm } from '@/auth/NameForm';
import { RequireUser } from '@/auth/RequireAuth';

export default function NameRoute() {
  return (
    <RequireUser>
      <NameForm />
    </RequireUser>
  );
}
