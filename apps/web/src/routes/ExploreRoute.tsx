import { useNavigate } from 'react-router';
import { ExploreContent } from '@/components/ExplorePage';
import { SettingsShell } from '@/components/SettingsShell';

/** Explore as its own page (T-1972), so it has a URL and browser Back works. */
export function ExploreRoute() {
  const navigate = useNavigate();

  // Back goes to where the page came from; a fresh link (no history) falls
  // back to the chat list.
  const goBack = (): void => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  return (
    <SettingsShell
      title="Explore"
      subtitle="Public groups and channels anyone can join"
      onBack={goBack}
    >
      {/* Join and Open already navigated; the page has nothing left to close. */}
      <ExploreContent onDone={() => undefined} />
    </SettingsShell>
  );
}
