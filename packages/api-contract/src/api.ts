import { HttpApi } from 'effect/http-api';
import { AiMemoryGroup } from './ai-memory';
import { AisGroup } from './ais';
import { ApprovalsGroup } from './approvals';
import { AuditGroup } from './audit';
import { AuthGroup, AuthInvitesPublicGroup } from './auth';
import { BackgroundsGroup } from './backgrounds';
import { BlocksGroup } from './blocks';
import { ChatFoldersGroup } from './chat-folders';
import { ChatPrefsGroup } from './chat-prefs';
import { ChatsGroup } from './chats';
import { ConnectionsGroup } from './connections';
import { ContactRequestsGroup } from './contact-requests';
import { ContactsGroup } from './contacts';
import { DirectoryGroup } from './directory';
import { GifsGroup } from './gifs';
import { GroupsGroup } from './groups';
import { HandlesGroup } from './handles';
import { IntegrationsGroup } from './integrations';
import { InviteLinksGroup } from './invite-links';
import { MachinesGroup } from './machines';
import { MediaGroup } from './media';
import { PinsGroup } from './pins';
import { PushGroup } from './push';
import { RolesGroup } from './roles';
import { RoutinesGroup } from './routines';
import { SearchGroup } from './search';
import { StickersGroup } from './stickers';
import { ToolsGroup } from './tools';
import { TopicsGroup } from './topics';

/**
 * The whole HTTP API as one contract. Clients derive from it
 * (`makeZilarClient`); each server module still builds its own `HttpApi`
 * from its group until the modules are mounted as one API.
 */
export const ZilarApi = HttpApi.make('zilar').add(
  AiMemoryGroup,
  AisGroup,
  ApprovalsGroup,
  AuditGroup,
  AuthGroup,
  AuthInvitesPublicGroup,
  BackgroundsGroup,
  BlocksGroup,
  ChatFoldersGroup,
  ChatPrefsGroup,
  ChatsGroup,
  ConnectionsGroup,
  ContactRequestsGroup,
  ContactsGroup,
  DirectoryGroup,
  GifsGroup,
  GroupsGroup,
  HandlesGroup,
  IntegrationsGroup,
  InviteLinksGroup,
  MachinesGroup,
  MediaGroup,
  PinsGroup,
  PushGroup,
  RolesGroup,
  RoutinesGroup,
  SearchGroup,
  StickersGroup,
  ToolsGroup,
  TopicsGroup,
);
