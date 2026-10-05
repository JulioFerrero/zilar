# Mobile parity roadmap (web features on the phone)

Julio, 2026-10-03: "implement all the features we have in web into the mobile app". This supersedes the earlier 80/20 web-first rule for the features listed here; new features still land on web and mobile together from now on.

Audit method: compared `apps/web/src/routes` and `apps/web/src/components` with `apps/mobile/src/app` and `apps/mobile/src/components` (2026-10-03).

## Already on mobile
Chat list with folders and search, chat and group screens, topics, channels, pins, reactions, replies, edits, voice notes, attachments, GIFs, stickers (send), emoji sheet, invite links, group roles, AI list/detail/create, approval card inside chats, sign-in and invite join.

## Missing on mobile (what this roadmap builds)
| Wave | Task | Web source to mirror | What the phone gets |
|---|---|---|---|
| 1 | T-0181 | `ProfilePage`, `HandlePage`, `SettingsShell`, `ProfileSettingsSection`, `AvatarUploader` | Settings hub, profile (name, avatar, @handle), the handle step after sign-up |
| 1 | T-0182 | `AddContactRoute`, `AddContactDialog`, `RequestsPage`, `/u/:handle` | Find a person by exact @handle, profile card, contact requests (send, accept, decline, cancel) |
| 1 | T-0183 | `ExplorePage`, `GroupHandleRoute`, `VisibilitySection` | Explore public groups and channels, open `@group` links, join, group visibility and handle |
| 1 | T-0184 | `ApprovalsPage`, `AlwaysAllowedList` | Approvals page: pending, history, always-allowed rules |
| 2 | T-0185 | `MachinesPage`, `machines/*`, `ConnectionsPage` | Machines (approve, deny, revoke, rename, delete) and model connections (create, test, delete) |
| 2 | T-0186 | `NotificationsPage` | Notification settings (needs the push work of T-0172 on the server side) |
| 2 | T-0187 | `StickersPage` | Manage sticker packs: my packs, discover, add and remove, reorder, favourites |
| 2 | T-0191 | `PackEditor`, `TelegramImportDialog` | Create and edit sticker packs, import from Telegram (after T-0187) |
| 2 | T-0188 | `IntegrationsPage` (owner) | Owner integrations: Telegram, email, voice transcription settings |
| 3 | T-0189 | `tools/*`, `AiActivity`, `AiPanel` | AI tools, routines and the activity feed on the AI screen |
| 3 | T-0190 | `MentionPicker`, `InviteDialog`, `NewGroupDialog` | @mention picker in the composer and the remaining dialog gaps |

Not planned for mobile: `SetupPage` (the first-run owner setup is a web job), `TopicKeyboardNav` (keyboard only).

## State (2026-10-05)

Merged: T-0181 (settings hub, profile, handle step), T-0182 (contacts by @handle), T-0183 (Explore, `@group` links, visibility), T-0184 (approvals page), T-0185 (machines, model connections), T-0187 (sticker packs), T-0188 (owner integrations), T-0191 (sticker pack editor) with follow-up T-0207 (Telegram sticker import), T-0193 (mobile @handle people search; web side T-0192), T-0189 (AI tools and routines, read) with follow-ups T-0212 (routine pause/resume/delete), T-0213 (AI activity feed) and T-0218 (read-only tool detail sheet), T-0190 (invite link sheet, New message box) with follow-up T-0214 (New group sheet).

Open: T-0186 notification settings (blocked on server push); the @mention picker and New channel parity from T-0190 (planned); tool writes T-0219 (in progress).

## Rules for every task
- Mirror the web behaviour and API; do not change the server unless the spec says so.
- Same layering as the existing mobile code: `src/lib/<area>-api.ts` (zod at the boundary, an error class with `status` and `code`), a hook that picks the real API or the mock, screens under `src/app`, components under `src/components/<area>`.
- Lucide icons only, no emoji in UI chrome; follow `docs/design/ui-style.md`.
- Phone-only concerns: pickers use `expo-image-picker`, the keyboard never hides the input, every list has loading, empty and error states.
- Each task adds exactly one row to `apps/mobile/src/lib/settings-items.ts` when it adds a settings page (created by T-0181).
