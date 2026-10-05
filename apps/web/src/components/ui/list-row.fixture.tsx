import { Bell, LogOut, Shield, Volume2 } from 'lucide-react';
import { MemoryRouter } from 'react-router';
import { ListRow } from './list-row';

export default {
  WithChevron: (
    <ListRow icon={<Bell />} title="Notifications" subtitle="Sounds and vibrations" chevron />
  ),
  WithTrailing: <ListRow icon={<Volume2 />} title="Message sounds" trailing="On" />,
  Danger: <ListRow icon={<LogOut />} title="Log out" onClick={() => {}} danger />,
  Plain: <ListRow title="About Zilar" subtitle="Version 0.1.0" />,
  Href: (
    <MemoryRouter>
      <ListRow
        icon={<Shield />}
        title="Privacy"
        subtitle="Who can see you"
        href="/settings/privacy"
      />
    </MemoryRouter>
  ),
};
