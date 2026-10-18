import type { PreviewKind } from '@zilar/chat-core';
import {
  File,
  Image as ImageIcon,
  Images,
  Mic,
  Paperclip,
  type LucideIcon,
} from 'lucide-react-native';

import { MUTED_FOREGROUND } from '@/lib/colors';

const PREVIEW_ICONS: Record<PreviewKind, LucideIcon> = {
  photo: ImageIcon,
  album: Images,
  voice: Mic,
  file: Paperclip,
  card: File,
};

// The small muted lucide icon before a non-text preview (`Photo`, `3 photos`, …); emoji stay out of the app chrome. Renders nothing for plain text.
export function PreviewIcon({ kind, size = 14 }: { kind: PreviewKind | undefined; size?: number }) {
  if (kind === undefined) {
    return null;
  }
  const Icon = PREVIEW_ICONS[kind];
  return <Icon size={size} color={MUTED_FOREGROUND} />;
}
