// T-1336: the chat list still renders this name (`ChatListBody.tsx`, outside
// this task's Allowed files); the request rows themselves live in
// `RequestRows.tsx`, which replaced the old single-row link.
export { RequestRows as ContactRequestsRow } from './RequestRows';
