import { Activity, Image, Pin, ShieldCheck } from 'lucide-react-native';

import { InfoRow, InfoRowGroup } from '@/components/group-info/info-row';

type ChannelContentRowsProps = {
  pinsCount: number | undefined;
  isManager: boolean;
  onOpenMedia: () => void;
  onOpenPins: () => void;
  onOpenActivity: () => void;
  onOpenAllowed: () => void;
};

export function ChannelContentRows({
  pinsCount,
  isManager,
  onOpenMedia,
  onOpenPins,
  onOpenActivity,
  onOpenAllowed,
}: ChannelContentRowsProps) {
  return (
    <InfoRowGroup>
      <InfoRow icon={Image} label="Shared media" onPress={onOpenMedia} />
      <InfoRow icon={Pin} label="Pinned messages" count={pinsCount} onPress={onOpenPins} />
      {isManager ? <InfoRow icon={Activity} label="Activity" onPress={onOpenActivity} /> : null}
      {isManager ? (
        <InfoRow icon={ShieldCheck} label="Always allowed" onPress={onOpenAllowed} />
      ) : null}
    </InfoRowGroup>
  );
}
