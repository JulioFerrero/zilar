import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { AddContactDialog } from '@/components/AddContactDialog';

/** `/:@handle` and `/u/:handle`: logged in opens Add contact prefilled. */
export function AddContactRoute() {
  const auth = useAuth();
  const params = useParams<{ handle?: string }>();
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);

  if (auth.status === 'loading') {
    return null;
  }
  if (auth.status === 'guest') {
    const handle = params.handle ?? '';
    return <Navigate to="/login" replace state={{ from: `/@${handle}` }} />;
  }

  const close = (): void => {
    setOpen(false);
    navigate('/', { replace: true });
  };

  if (!open) {
    return null;
  }
  return <AddContactDialog initialHandle={params.handle} onClose={close} />;
}
