const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = withNativeWind(getDefaultConfig(__dirname), {
  input: './src/global.css',
  inlineRem: 16,
});

// @xmpp/client ships a `browser` field mapping the TCP/TLS/STARTTLS/SCRAM
// packages to `false`, but Metro only reads the `browser` field for the main
// entry, not for module substitution. Those packages import `node:tls`/`node:net`
// and `@xmpp/resolve` imports `node:dns`, none of which exist in the native
// runtime. Replace them with an empty module — the same effect the browser
// field intended — so the WebSocket-only path (which the app always uses,
// because it connects with an explicit `ws://` service) bundles cleanly.
const STUBBED = new Set([
  '@xmpp/tcp',
  '@xmpp/tls',
  '@xmpp/starttls',
  '@xmpp/sasl-scram-sha-1',
  'node:dns',
  'node:net',
  'node:tls',
  'node:http',
  'node:https',
]);

const emptyModule = require.resolve('./src/spike/empty.js');
const previousResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform, realModuleName) => {
  if (STUBBED.has(moduleName)) {
    return { type: 'sourceFile', filePath: emptyModule };
  }
  if (previousResolveRequest) {
    return previousResolveRequest(context, moduleName, platform, realModuleName);
  }
  return context.resolveRequest(context, moduleName, platform, realModuleName);
};

module.exports = config;
