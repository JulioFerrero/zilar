import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../ui/icon-button';
import { ScreenHeader } from '../ui/screen-header';

/**
 * A subpage of the group info panel (T-1494): the back and close keys, the page
 * title, and the sections of that page scrolling below. The channel info panel
 * reuses it with `noun="channel"` (T-1519).
 */
export function GroupInfoPage({
  title,
  onBack,
  onClose,
  noun = 'group',
  children,
}: {
  title: string;
  onBack: () => void;
  onClose: () => void;
  /** The entity the info is about; drives the back and close labels. */
  noun?: 'group' | 'channel';
  children?: ReactNode;
}) {
  return (
    <>
      <ScreenHeader
        variant="sub"
        title={title}
        onBack={onBack}
        backLabel={`Back to ${noun} info`}
        right={
          <IconButton aria-label={`Close ${noun} info`} onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
          </IconButton>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">{children}</div>
    </>
  );
}
