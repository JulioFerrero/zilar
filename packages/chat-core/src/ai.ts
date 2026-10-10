// Whether a JID belongs to one of our AIs (`ai-<aiId>@<domain>`). The rule
// lives in @zilar/protocol; it is re-exported so the Markdown rule in
// `markdown.ts` and the web UI's AI badge can never disagree.
export { isAiJid } from '@zilar/protocol';
