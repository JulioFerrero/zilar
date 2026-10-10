const { existsSync } = require('node:fs');
const path = require('node:path');

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

// The stub is permanent (it is not part of the throwaway spike), so guard that
// it still resolves: a future move must fail here with a clear message rather
// than silently breaking every bundle the moment the file is gone.
const emptyModule = path.resolve(__dirname, 'src/lib/xmpp-node-stubs/empty.js');
if (!existsSync(emptyModule)) {
  throw new Error(
    `The XMPP Node stub is missing at ${emptyModule}. It is a permanent Metro ` +
      'requirement for @xmpp/client on native; restore it before bundling.',
  );
}

// expo-router's Android native-tabs icon converter imports expo-symbols, whose
// Material weights import @expo-google-fonts/material-symbols. Metro bundles
// that 967 KB icon font even though the app never renders a Material Symbol
// (nothing in src or app imports expo-symbols or @expo/vector-icons; icons come
// from lucide). Stub the font package so the file is not bundled.
const UNUSED_ICON_FONT = '@expo-google-fonts/material-symbols';

const previousResolveRequest = config.resolver.resolveRequest;

// @zilar/client-core has its own node_modules (react, effect, @effect/atom-react
// at the web app's versions). A second copy of react or of the atom-react
// RegistryContext would break the hooks, so every bare import made from the
// package resolves from this app instead.
const clientCoreDir = path.resolve(__dirname, '../../packages/client-core') + path.sep;
const appOrigin = path.resolve(__dirname, 'package.json');

config.resolver.resolveRequest = (context, moduleName, platform, realModuleName) => {
  if (
    context.originModulePath.startsWith(clientCoreDir) &&
    !moduleName.startsWith('.') &&
    !path.isAbsolute(moduleName)
  ) {
    return context.resolveRequest(
      { ...context, originModulePath: appOrigin },
      moduleName,
      platform,
    );
  }
  if (
    STUBBED.has(moduleName) ||
    moduleName === UNUSED_ICON_FONT ||
    moduleName.startsWith(`${UNUSED_ICON_FONT}/`)
  ) {
    return { type: 'sourceFile', filePath: emptyModule };
  }
  if (previousResolveRequest) {
    return previousResolveRequest(context, moduleName, platform, realModuleName);
  }
  return context.resolveRequest(context, moduleName, platform, realModuleName);
};

module.exports = config;
