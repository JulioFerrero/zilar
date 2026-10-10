import { HttpApi } from 'effect/http-api';
import { PinsGroup } from './pins';

// Each chain adds its groups inside its own area, one import line and one
// array line per group (`FooGroup,`). The arrays are spread into one
// `.add(...)` below, so the `HttpApi` type still carries every group and the
// derived client stays typed. Keep the comment lines around each area: they
// keep the chains' edits apart so parallel moves merge without conflicts.

// Chain A (T-0892) imports: add `import { XGroup } from './x';` lines below.
import { ChatFoldersGroup } from './chat-folders';
import { ChatPrefsGroup } from './chat-prefs';
import { GroupsGroup } from './groups';
import { InviteLinksGroup } from './invite-links';
import { RolesGroup } from './roles';
import { TopicsGroup } from './topics';
// ----------------------------------------------------------------------------
// End of chain A imports.

// Chain A (T-0892) groups: add `XGroup,` lines inside the brackets.
// ----------------------------------------------------------------------------
const chainAGroups = [
  ChatPrefsGroup,
  ChatFoldersGroup,
  RolesGroup,
  InviteLinksGroup,
  GroupsGroup,
  TopicsGroup,
] as const;
// ----------------------------------------------------------------------------
// End of chain A.

// Chain B (T-0893) imports: add `import { XGroup } from './x';` lines below.
// ----------------------------------------------------------------------------
import { AuditGroup } from './audit';
import { AiMemoryGroup } from './ai-memory';
import { ConnectionsGroup } from './connections';
import { ApprovalsGroup } from './approvals';
import { AisGroup } from './ais';
import { ToolsGroup } from './tools';
import { RoutinesGroup } from './routines';
// End of chain B imports.

// Chain B (T-0893) groups: add `XGroup,` lines inside the brackets.
// ----------------------------------------------------------------------------
const chainBGroups = [
  AuditGroup,
  AiMemoryGroup,
  ConnectionsGroup,
  ApprovalsGroup,
  AisGroup,
  ToolsGroup,
  RoutinesGroup,
  // (chain B groups)
] as const;
// ----------------------------------------------------------------------------
// End of chain B.

// Chain C (T-0894) imports: add `import { XGroup } from './x';` lines below.
import { BlocksGroup } from './blocks';
import { ChatsGroup } from './chats';
import { ContactRequestsGroup } from './contact-requests';
import { ContactsGroup } from './contacts';
import { DirectoryGroup } from './directory';
import { HandlesGroup } from './handles';
import { SearchGroup } from './search';
// ----------------------------------------------------------------------------
// End of chain C imports.

// Chain C (T-0894) groups: add `XGroup,` lines inside the brackets.
// ----------------------------------------------------------------------------
const chainCGroups = [
  // (chain C groups)
  ContactsGroup,
  BlocksGroup,
  ContactRequestsGroup,
  HandlesGroup,
  DirectoryGroup,
  SearchGroup,
  ChatsGroup,
] as const;
// ----------------------------------------------------------------------------
// End of chain C.

// Chain D (T-0895) imports: add `import { XGroup } from './x';` lines below.
// ----------------------------------------------------------------------------
// End of chain D imports.

// Chain D (T-0895) groups: add `XGroup,` lines inside the brackets.
// ----------------------------------------------------------------------------
const chainDGroups = [
  // (chain D groups)
] as const;
// ----------------------------------------------------------------------------
// End of chain D.

/**
 * The whole HTTP API as one contract. Clients derive from it
 * (`makeZilarClient`); each server module still builds its own `HttpApi`
 * from its group until the modules are mounted as one API.
 */
export const ZilarApi = HttpApi.make('zilar').add(
  PinsGroup,
  ...chainAGroups,
  ...chainBGroups,
  ...chainCGroups,
  ...chainDGroups,
);
