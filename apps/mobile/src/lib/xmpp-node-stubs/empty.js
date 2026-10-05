// An empty CommonJS module, mapped over `@xmpp/*` packages that pull in Node
// builtins the native runtime does not provide, and over `node:*` specifiers.
// @xmpp/client ships a `browser` field that would disable these on web, but
// Metro only honours the `browser` field for the main entry, so metro.config.js
// replaces them explicitly instead. xmpp.js handles a non-function transport
// gracefully (`setupIfAvailable`), and the DNS resolver is never exercised
// because the client always connects with an explicit `ws://` service URL.
//
// This is a permanent requirement for using xmpp-core on native, so it lives in
// src/lib: metro.config.js fails loudly if this file goes missing.
module.exports = {};
