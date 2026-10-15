import { Activity, Image, Pin, ShieldCheck } from 'lucide-react-native';

import { InfoRow, InfoRowGroup } from '@/components/group-info/info-row';

type ChannelContentRowsProps = {
  /** The channel's pins, for the Pinned messages row; `undefined` until loaded. */
  pinsCount: number | undefined;
  /** Managers see Activity and Always allowed, like web's channel root. */
  isManager: boolean;
  onOpenMedia: () => void;
  onOpenPins: () => void;
  onOpenActivity: () => void;
  onOpenAllowed: () => void;
};

/**
 * The Content group of the channel root (T-1587), after web's channel info
 * (`ChannelInfoRoot.tsx:271-304`): Shared media and Pinned messages for
 * everyone, Activity and Always allowed for managers. The rows only open
 * pages and sheets; `channel-screen.tsx` owns the media/pins state and the
 * pages themselves.
 */
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
