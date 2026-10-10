import { Menu as MenuIcon } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { BeforeInstallPromptEvent } from '@/lib/push';
import { IconButton } from '../ui/icon-button';
import { Menu, MenuItem } from '../ui/menu';

// The menu close callback; `NavMenuItem` reads it instead of taking it per item.
const MenuCloseContext = createContext<(() => void) | null>(null);

interface NavMenuItemProps {
  to: string;
  label: string;
  badge?: ReactNode;
}

/** A menu entry that closes the menu and navigates to `to`. */
function NavMenuItem({ to, label, badge }: NavMenuItemProps) {
  const navigate = useNavigate();
  const closeMenu = useContext(MenuCloseContext);
  return (
    <MenuItem
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

export function ChatListMenu({
  open,
  onOpenChange,
  isWide,
  onInvite,
  onExplore,
  onSignOut,
  isServerOwner,
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
            <MenuItem
              onSelect={() => {
                close();
                onInvite();
              }}
            >
              Invite a friend
            </MenuItem>
            <NavMenuItem
              to="/settings/requests"
              label="Requests"
              badge={
                incomingRequests !== null && incomingRequests > 0 ? (
                  <span
                    aria-label={`${incomingRequests} incoming contact requests`}
                    className="shrink-0 rounded-full bg-badge-muted px-1.5 text-[11px] font-semibold text-foreground"
                  >
                    {incomingRequests > 9 ? '9+' : String(incomingRequests)}
                  </span>
                ) : undefined
              }
            />
            <NavMenuItem to="/settings/folders" label="Chat folders" />
            <NavMenuItem to="/settings/blocked" label="Blocked people" />
            <MenuItem
              onSelect={() => {
                close();
                onExplore();
              }}
            >
              Explore groups
            </MenuItem>
            <NavMenuItem to="/settings/profile" label="Profile" />
            <NavMenuItem to="/settings/connections" label="Connections" />
            <NavMenuItem to="/settings/machines" label="Machines" />
            <NavMenuItem
              to="/settings/approvals"
              label="Approvals"
              badge={
                approvalsBadge !== null ? (
                  <span
                    aria-label={`${approvalsBadge} pending approvals`}
                    className="shrink-0 rounded-full bg-badge-muted px-1.5 text-[11px] font-semibold text-foreground"
                  >
                    {approvalsBadge}
                  </span>
                ) : undefined
              }
            />
            <NavMenuItem to="/settings/ais" label="My AIs" />
            <NavMenuItem to="/settings/notifications" label="Notifications" />
            {installEvent !== null && (
              <MenuItem
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
            <NavMenuItem to="/settings/stickers" label="Stickers" />
            {isServerOwner && <NavMenuItem to="/settings/integrations" label="Integrations" />}
            <MenuItem destructive onSelect={onSignOut}>
              Sign out
            </MenuItem>
          </MenuCloseContext.Provider>
        </Menu>
      )}
    </div>
  );
}
