// Mapped over `@xmpp/*` packages that pull in Node builtins, and over `node:*`: Metro honours the `browser` field only for the main entry, so metro.config.js replaces them explicitly. The DNS resolver is never exercised, because the client always connects with an explicit `ws://` URL.
//
// metro.config.js fails loudly if this file goes missing.
module.exports = {};
