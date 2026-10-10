import { ditherAvatarDataUri } from '@zilar/chat-core';
import { cn } from '@/lib/utils';

export interface AvatarProps {
  id: string;
  name: string;
  size?: number;
  online?: boolean;
  /** Kept for callers; the dither avatar no longer changes for AIs. */
  ai?: boolean;
  avatarUrl?: string | undefined;
  className?: string;
}

export function Avatar({ id, size = 54, online = false, avatarUrl, className }: AvatarProps) {
  return (
    <span
      className={cn('relative inline-flex shrink-0', className)}
      style={{ width: size, height: size }}
    >
      {avatarUrl === undefined ? (
        <img
          src={ditherAvatarDataUri(id)}
          alt=""
          aria-hidden="true"
          className="h-full w-full rounded-full object-cover"
        />
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
