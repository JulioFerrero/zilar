import { initials } from '@galena/chat-core';
import { User } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AvatarProps {
  id: string;
  name: string;
  size?: number;
  online?: boolean;
  /** AIs get the light avatar; people and groups get a monochrome shade. */
  ai?: boolean;
  avatarUrl?: string | undefined;
  className?: string;
}

export interface AvatarShade {
  background: string;
  color: string;
  ring: boolean;
}

/** Monochrome shades for people and groups (`ui-style.md` §2). */
const PERSON_SHADES: readonly AvatarShade[] = [
  { background: '#262626', color: '#ededed', ring: false },
  { background: '#1a1a1a', color: '#ededed', ring: true },
];

const AI_SHADE: AvatarShade = { background: '#ededed', color: '#0a0a0a', ring: false };

function hashId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Picks the avatar shade deterministically from the id. */
export function avatarShade(id: string, ai = false): AvatarShade {
  if (ai) {
    return AI_SHADE;
  }
  return PERSON_SHADES[hashId(id) % PERSON_SHADES.length] ?? PERSON_SHADES[0]!;
}

export function Avatar({
  id,
  name,
  size = 54,
  online = false,
  ai = false,
  avatarUrl,
  className,
}: AvatarProps) {
  const shade = avatarShade(id, ai);
  const label = initials(name);

  return (
    <span
      className={cn('relative inline-flex shrink-0', className)}
      style={{ width: size, height: size }}
    >
      {avatarUrl === undefined ? (
        <span
          aria-hidden="true"
          className="flex h-full w-full items-center justify-center rounded-full font-semibold select-none"
          style={{
            backgroundColor: shade.background,
            color: shade.color,
            border: shade.ring ? '1px solid #333333' : undefined,
            fontSize: Math.round(size * 0.35),
          }}
        >
          {label.length > 0 ? (
            label
          ) : (
            <User
              aria-hidden="true"
              style={{ width: Math.round(size * 0.5), height: Math.round(size * 0.5) }}
            />
          )}
        </span>
      ) : (
        <img src={avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
      )}
      {online && (
        <span
          aria-label="Online"
          className="absolute right-0 bottom-0 rounded-full border-2 border-[var(--avatar-ring)] bg-online"
          style={{ width: 10, height: 10 }}
        />
      )}
    </span>
  );
}
