import { nameSeed } from './avatar-seed';

export interface AvatarPersonInput {
  name: string;
  id?: string | undefined;
  userId?: string | undefined;
  avatarUrl?: string | undefined;
  image?: string | null | undefined;
}

export interface AvatarChatInput {
  id: string;
  title: string;
  avatarUrl?: string | undefined;
}

export type AvatarIdentityInput = AvatarPersonInput | AvatarChatInput;

export interface AvatarIdentity {
  name: string;
  seed: string;
  avatarUrl?: string | undefined;
}

function isChat(input: AvatarIdentityInput): input is AvatarChatInput {
  return 'title' in input;
}

// The orb's colour and light come from the normalized display name, so the same name draws the same ball on every screen; the id is only the fallback.
export function avatarIdentity(input: AvatarIdentityInput): AvatarIdentity {
  const raw = isChat(input) ? input.title : input.name;
  const id = (isChat(input) ? input.id : (input.userId ?? input.id)) ?? '';
  const name = raw.trim() === '' ? id : raw.trim();
  const avatarUrl = isChat(input) ? input.avatarUrl : (input.avatarUrl ?? input.image ?? undefined);
  return {
    name,
    seed: nameSeed(raw) || id,
    ...(avatarUrl === undefined || avatarUrl === '' ? {} : { avatarUrl }),
  };
}
