import { useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { AddContactDialog } from '@/components/AddContactDialog';

/** Share entry points: /u/:handle and /@handle. Logged in opens the Add contact dialog
 * prefilled; logged out goes to login and returns to the real URL afterwards. */
export function AddContactRoute({ atHandle }: { atHandle?: string | undefined }) {
  const auth = useAuth();
  const params = useParams<{ handle?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);

  // The real URL the visitor opened, recorded for the login return trip.
  const here = `${location.pathname}${location.search}`;
  const handle = atHandle ?? params.handle ?? '';

  if (auth.status === 'loading') {
    return null;
  }
  if (auth.status === 'guest') {
    return <Navigate to="/login" replace state={{ from: here }} />;
  }

  const close = (): void => {
    setOpen(false);
    navigate('/', { replace: true });
  };

  if (!open) {
    return null;
  }
  // Keyed by handle so /@alice then /@bob re-seeds the dialog state.
  return <AddContactDialog key={handle} initialHandle={handle} onClose={close} />;
}
