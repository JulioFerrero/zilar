// The audit service barrel (T-1016 size split): the old `audit/service.ts`
// contents live in `schema.ts` (the entry schema and its decoder),
// `recorder.ts` (the recorder and the row insert) and `list.ts` (the
// visibility-filtered list reads). This path re-exports every name it
// exported before, so importers do not change.

export { MAX_AUDIT_LIST_LIMIT } from '@zilar/api-contract';
export type { AuditEntry } from './schema';
export { createAuditRecorder, recordAudit } from './recorder';
export type { AuditLogger, AuditRecorder, CreateAuditRecorderInput } from './recorder';
export { DEFAULT_AUDIT_LIST_LIMIT, listAuditForAi, listAuditForGroup } from './list';
export type { ListAuditOptions, ListAuditPage, PublicAuditEntry } from './list';
