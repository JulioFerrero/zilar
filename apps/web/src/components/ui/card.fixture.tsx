import { Bell, Shield } from 'lucide-react';
import { Card, SectionLabel } from './card';
import { ListRow } from './list-row';

export default {
  GroupedRows: (
    <div className="max-w-sm">
      <SectionLabel>Account</SectionLabel>
      <Card>
        <ListRow icon={<Shield />} title="Privacy" chevron onClick={() => {}} />
        <ListRow icon={<Bell />} title="Notifications" chevron onClick={() => {}} />
      </Card>
    </div>
  ),
  Empty: <Card className="max-w-sm p-4">Plain content</Card>,
};
