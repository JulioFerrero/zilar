import {
  Bot,
  Compass,
  Download,
  Menu as MenuIcon,
  Settings,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { EntityAvatar } from '@/components/EntityAvatar';
import { useAuth } from '@/auth/AuthProvider';
import type { BeforeInstallPromptEvent } from '@/lib/push';
import { IconButton } from '../ui/icon-button';
import { Menu, MenuItem } from '../ui/menu';

// The menu close callback; `NavMenuItem` reads it instead of taking it per item.
const MenuCloseContext = createContext<(() => void) | null>(null);

interface NavMenuItemProps {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: ReactNode;
}

/** A menu entry that closes the menu and navigates to `to`. */
function NavMenuItem({ to, label, icon, badge }: NavMenuItemProps) {
  const navigate = useNavigate();
  const closeMenu = useContext(MenuCloseContext);
  return (
    <MenuItem
      icon={icon}
      onSelect={() => {
        closeMenu?.();
        navigate(to);
      }}
    >
      {badge === undefined ? (
        label
      ) : (
        <>
          <span className="flex-1">{label}</span>
          {badge}
        </>
      )}
    </MenuItem>
  );
}

/** The menu's profile row: avatar, name and @handle (or email), to the profile page. */
function ProfileMenuItem() {
  const auth = useAuth();
  const navigate = useNavigate();
  const closeMenu = useContext(MenuCloseContext);
  const user = auth.user;
  if (user === undefined) {
    return null;
  }
  const handle = user.handle;
  const secondary = typeof handle === 'string' && handle !== '' ? `@${handle}` : user.email;
  return (
    <MenuItem
      onSelect={() => {
        closeMenu?.();
        navigate('/settings/profile');
      }}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        <EntityAvatar me size={32} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{user.name}</span>
          <span className="truncate text-[13px] text-muted-foreground">{secondary}</span>
        </span>
      </span>
    </MenuItem>
  );
}

/** The requests count pill, capped at 9+ like the approvals one. */
function RequestBadge({ count }: { count: number }) {
  return (
    <span
      aria-label={`${count} incoming contact requests`}
      className="shrink-0 rounded-full bg-badge-muted px-1.5 text-[11px] font-semibold text-foreground"
    >
      {count > 9 ? '9+' : String(count)}
    </span>
  );
}

/** The approvals count pill (the hook already caps the string). */
function ApprovalBadge({ text }: { text: string }) {
  return (
    <span
      aria-label={`${text} pending approvals`}
      className="shrink-0 rounded-full bg-badge-muted px-1.5 text-[11px] font-semibold text-foreground"
    >
      {text}
    </span>
  );
}

export interface ChatListMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isWide: boolean;
  onInvite: () => void;
  onExplore: () => void;
  onSignOut: () => void;
  isServerOwner: boolean;
  incomingRequests: number | null;
  approvalsBadge: string | null;
  installEvent: BeforeInstallPromptEvent | null;
  installFailed: boolean;
  installing: boolean;
  onInstall: () => void;
}

/**
 * The short hamburger menu: the profile row, Contacts (with the requests
 * badge), My AIs, Explore groups, Invite a friend and Settings (with the
 * approvals badge), plus Install app as a conditional seventh item while the
 * browser offers `beforeinstallprompt`. The other entries — and Sign out —
 * live in the `/settings` hub now; the install props are used by that item.
 * `onSignOut` and `isServerOwner` stay in the props because `ChatList.tsx`
 * still passes them; the menu no longer uses either.
 */
export function ChatListMenu({
  open,
  onOpenChange,
  isWide,
  onInvite,
  onExplore,
  incomingRequests,
  approvalsBadge,
  installEvent,
  installFailed,
  installing,
  onInstall,
}: ChatListMenuProps) {
  const close = (): void => onOpenChange(false);
  return (
    <div className="relative">
      <IconButton
        aria-label="Open menu"
        aria-haspopup="menu"
        aria-expanded={open}
        size={isWide ? 36 : 40}
        radius={isWide ? 10 : 12}
        onClick={() => onOpenChange(!open)}
      >
        <MenuIcon className="size-[18px]" aria-hidden="true" />
      </IconButton>
      {open && (
        <Menu
          open={open}
          onClose={close}
          label="Main menu"
          closeLabel="Close menu"
          className="top-full right-0 mt-1 wide:left-0 wide:right-auto"
        >
          <MenuCloseContext.Provider value={close}>
            <ProfileMenuItem />
            <NavMenuItem
              to="/settings/contacts"
              label="Contacts"
              icon={Users}
              badge={
                incomingRequests !== null && incomingRequests > 0 ? (
                  <RequestBadge count={incomingRequests} />
                ) : undefined
              }
            />
            <NavMenuItem to="/settings/ais" label="My AIs" icon={Bot} />
            <MenuItem
              icon={Compass}
              onSelect={() => {
                close();
                onExplore();
              }}
            >
              Explore groups
            </MenuItem>
            <MenuItem
              icon={UserPlus}
              onSelect={() => {
                close();
                onInvite();
              }}
            >
              Invite a friend
            </MenuItem>
            <NavMenuItem
              to="/settings"
              label="Settings"
              icon={Settings}
              badge={approvalsBadge !== null ? <ApprovalBadge text={approvalsBadge} /> : undefined}
            />
            {installEvent !== null && (
              <MenuItem
                icon={Download}
                onSelect={() => {
                  close();
                  // A click while a prompt waits is dropped before prompt() runs.
                  if (!installing) {
                    onInstall();
                  }
                }}
              >
                {installFailed ? 'Install failed — try again' : 'Install app'}
              </MenuItem>
            )}
          </MenuCloseContext.Provider>
        </Menu>
      )}
    </div>
  );
}
