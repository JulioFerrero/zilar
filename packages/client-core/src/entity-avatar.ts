import type { AvatarChatInput, AvatarPersonInput } from '@zilar/chat-core';

export type EntityAvatarProps = {
  person?: AvatarPersonInput | null | undefined;
  chat?: AvatarChatInput | null | undefined;
  me?: boolean | undefined;
  size?: number | undefined;
  online?: boolean | undefined;
  ai?: boolean | undefined;
  className?: string | undefined;
};
