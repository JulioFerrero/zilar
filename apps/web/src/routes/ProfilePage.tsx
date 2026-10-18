import { useNavigate } from 'react-router';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { ProfileSettingsSection } from '@/components/ProfileSettingsSection';

export function ProfilePage() {
  const navigate = useNavigate();
  return (
    <SettingsShell
      title="Profile"
      subtitle="Your picture and username, seen by your contacts."
      onBack={() => navigate('/settings')}
    >
      <div className={SETTINGS_COLUMN}>
        <ProfileSettingsSection />
      </div>
    </SettingsShell>
  );
}
