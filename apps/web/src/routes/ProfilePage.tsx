import { useNavigate } from 'react-router';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { ProfileSettingsSection } from '@/components/ProfileSettingsSection';

/** Settings → Profile: the caller's name is set at onboarding; here live
 *  the picture and the `@username` (T-0163 section, T-0165 picture). */
export function ProfilePage() {
  const navigate = useNavigate();
  return (
    <SettingsShell
      title="Profile"
      subtitle="Your picture and username, seen by your contacts."
      onBack={() => navigate('/')}
    >
      <div className={SETTINGS_COLUMN}>
        <ProfileSettingsSection />
      </div>
    </SettingsShell>
  );
}
