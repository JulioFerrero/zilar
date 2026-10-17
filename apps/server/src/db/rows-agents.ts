// Row of the `approvals` table.
export interface ApprovalRow {
  id: string;
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  action: string;
  summary: string;
  details: string | null;
  argsHash: string;
  worstCaseCurrency: string | null;
  worstCaseAmount: string | null;
  requestedBy: string;
  status: 'pending' | 'approved_once' | 'approved_always' | 'denied' | 'consumed';
  decidedBy: string | null;
  decidedAt: Date | null;
  note: string | null;
  expiresAt: Date;
  createdAt: Date;
}

// Insert shape of the `approvals` table.
export interface ApprovalInsert {
  id: string;
  aiId: string;
  groupId?: string | null | undefined;
  topicId?: string | null | undefined;
  action: string;
  summary: string;
  details?: string | null | undefined;
  argsHash: string;
  worstCaseCurrency?: string | null | undefined;
  worstCaseAmount?: string | null | undefined;
  requestedBy: string;
  status?: 'pending' | 'approved_once' | 'approved_always' | 'denied' | 'consumed' | undefined;
  decidedBy?: string | null | undefined;
  decidedAt?: Date | null | undefined;
  note?: string | null | undefined;
  expiresAt: Date;
  createdAt?: Date | undefined;
}

// Row of the `ai_questions` table.
export interface AiQuestionRow {
  id: string;
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  roomJid: string;
  messageId: string | null;
  question: string;
  options: string[];
  status: 'open' | 'answered' | 'expired';
  answer: string | null;
  answeredBy: string | null;
  expiresAt: Date;
  createdAt: Date;
  answeredAt: Date | null;
}

// Insert shape of the `ai_questions` table.
export interface AiQuestionInsert {
  id: string;
  aiId: string;
  groupId?: string | null | undefined;
  topicId?: string | null | undefined;
  roomJid: string;
  messageId?: string | null | undefined;
  question: string;
  options: string[];
  status?: 'open' | 'answered' | 'expired' | undefined;
  answer?: string | null | undefined;
  answeredBy?: string | null | undefined;
  expiresAt: Date;
  createdAt?: Date | undefined;
  answeredAt?: Date | null | undefined;
}

// Row of the `pending_actions` table.
export interface PendingActionRow {
  id: string;
  approvalId: string;
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  action: string;
  args: unknown;
  argsHash: string;
  requestedBy: string;
  status: 'waiting' | 'running' | 'executed' | 'failed' | 'cancelled';
  resultSummary: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

// Row of the `approval_rules` table.
export interface ApprovalRuleRow {
  id: string;
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  action: string;
  createdBy: string;
  createdAt: Date;
  revokedAt: Date | null;
  revokedBy: string | null;
}

// Row of the `ai_tools` table.
export interface AiToolRow {
  id: string;
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  name: string;
  description: string;
  currentVersion: number;
  approvedHosts: string[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

// Row of the `ai_tool_versions` table.
export interface AiToolVersionRow {
  id: string;
  toolId: string;
  version: number;
  source: string;
  hosts: string[];
  message: string;
  createdBy: string;
  createdAt: Date;
}

// Row of the `ai_tool_runs` table.
export interface AiToolRunRow {
  id: string;
  toolId: string;
  version: number;
  trigger: 'manual' | 'routine' | 'ai';
  status: 'ok' | 'error';
  errorKind: string | null;
  durationMs: number;
  fetchCount: number;
  outputText: string | null;
  createdAt: Date;
}

// Row of the `routines` table.
export interface RoutineRow {
  id: string;
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  kind: 'tool' | 'prompt';
  // T-1638: a prompt routine has no tool.
  toolId: string | null;
  prompt: string | null;
  title: string;
  schedule: unknown;
  input: unknown;
  approvedHosts: string[];
  status: 'active' | 'paused' | 'needs_approval';
  pausedReason: 'user' | 'failures' | 'hosts_changed' | null;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastStatus: 'ok' | 'error' | 'skipped' | null;
  // T-1713: the routine's single live message; both null until it posts.
  lastMessageId: string | null;
  lastMessageAt: Date | null;
  // T-1856: the alert card block that drives this routine; both null when none is linked.
  alertCardId: string | null;
  alertBlockId: string | null;
  consecutiveFailures: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

// Row of the `block_cards` table. `data` is a checked `BlocksData` payload; the
// row type stays `unknown` so `db/` does not depend on the protocol package.
export interface BlockCardRow {
  originId: string;
  stanzaId: string | null;
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  roomJid: string;
  data: unknown;
  createdAt: Date;
  updatedAt: Date;
}

// Insert shape of the `block_cards` table.
export interface BlockCardInsert {
  originId: string;
  stanzaId?: string | null | undefined;
  aiId: string;
  groupId?: string | null | undefined;
  topicId?: string | null | undefined;
  roomJid: string;
  data: unknown;
  createdAt?: Date | undefined;
  updatedAt?: Date | undefined;
}

// Row of the `block_responses` table: one interaction, keyed by the block and
// item it answered (`''` for a block-level answer).
export interface BlockResponseRow {
  cardId: string;
  blockId: string;
  itemId: string;
  actorId: string;
  value: unknown;
  createdAt: Date;
  updatedAt: Date;
}

// Row of the `media_items` table.
export interface MediaItemRow {
  id: string;
  archiveOwner: string;
  chatJid: string;
  messageId: string;
  atMicros: number;
  senderJid: string;
  kind: 'image' | 'file' | 'gif' | 'voice' | 'link';
  url: string | null;
  name: string | null;
  mime: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  waveform: number[] | null;
  linkUrl: string | null;
  linkHost: string | null;
  ref: string;
  deleted: boolean;
  createdAt: Date;
}

// Row of the `card_media` table (T-1847): one AI card image or file whose
// bytes live under `CARD_MEDIA_STORAGE_DIR` at `storageKey` (a server-made
// `<uuid>`, never user input).
export interface CardMediaRow {
  id: string;
  aiId: string;
  roomJid: string;
  groupId: string | null;
  topicId: string | null;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  name: string;
  storageKey: string;
  createdAt: Date;
}

// Insert shape of the `card_media` table.
export interface CardMediaInsert {
  id: string;
  aiId: string;
  roomJid: string;
  groupId?: string | null | undefined;
  topicId?: string | null | undefined;
  mime: string;
  size: number;
  width?: number | null | undefined;
  height?: number | null | undefined;
  name: string;
  storageKey: string;
  createdAt?: Date | undefined;
}
