import { Bell, Plus, Search } from 'lucide-react';
import { PanelKey } from './panel-key';

const noop = (): void => undefined;

export default {
  Default: <PanelKey label="Mute" icon={Bell} onClick={noop} />,
  Row: (
    <div className="flex justify-center gap-1">
      <PanelKey label="Mute" icon={Bell} onClick={noop} />
      <PanelKey label="Search" icon={Search} onClick={noop} />
      <PanelKey label="Add" icon={Plus} onClick={noop} />
    </div>
  ),
  Disabled: <PanelKey label="Mute" icon={Bell} onClick={noop} disabled />,
};
