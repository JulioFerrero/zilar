import type { PublicAi } from '@/lib/api';
import { AvatarUploader } from '@/components/AvatarUploader';
import { stripAvatarUrl } from './aiPanelOps';

/** The AI's picture (T-0165), for the AI's owner. Refreshes the panel row
 *  from the uploader's answer so the header shows the new picture at once. */
export function AiPictureSection({
  ai,
  onChanged,
}: {
  ai: PublicAi;
  onChanged: (ai: PublicAi) => void;
}) {
  return (
    <AvatarUploader
      kind="ai"
      ownerId={ai.id}
      ownerName={ai.name}
      currentUrl={ai.avatarUrl}
      onChanged={(url) =>
        onChanged(url === undefined ? stripAvatarUrl(ai) : { ...ai, avatarUrl: url })
      }
    />
  );
}
