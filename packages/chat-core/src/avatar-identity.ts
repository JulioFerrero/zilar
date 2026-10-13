import { nameSeed } from './avatar-seed';

/**
 * A person, contact, member, AI or own profile as a screen holds it. The
 * picture URL may arrive as `avatarUrl` (contacts, members, profiles) or
 * `image` (handle lookups, blocks).
 */
export interface AvatarPersonInput {
  name: string;
  id?: string | undefined;
  userId?: string | undefined;
  avatarUrl?: string | undefined;
  image?: string | null | undefined;
}

/** A chat row: a DM peer, group, channel, topic or AI chat. */
export interface AvatarChatInput {
  id: string;
  title: string;
  avatarUrl?: string | undefined;
}

export type AvatarIdentityInput = AvatarPersonInput | AvatarChatInput;

export interface AvatarIdentity {
  /** The display name (the id when the entity carries no name). */
  name: string;
  /** The orb seed: the normalized name, else the id. */
  seed: string;
  /** The picture URL, when the entity carries one. */
  avatarUrl?: string | undefined;
}

function isChat(input: AvatarIdentityInput): input is AvatarChatInput {
  return 'title' in input;
}

/**
 * The one place that decides an avatar's identity (T-1334): the orb's colour
 * and light come from the normalized display name, so the same name draws the
 * same ball on every screen. The id is only the fallback when the name is
 * empty. The picture is the URL the entity already carries.
 */
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
