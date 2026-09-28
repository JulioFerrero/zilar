// Build-time configuration for the spike, read from `EXPO_PUBLIC_SPIKE_*`
// environment variables (Expo inlines `EXPO_PUBLIC_*` into the bundle at
// Metro/bundle time). Kept as a pure function of an env record so it is easy to
// unit-test without touching `process.env`.

export type SpikeConfig = {
  service: string;
  domain: string;
  apiUrl: string;
  selfJid: string;
  selfToken: string;
  peerJid: string;
  peerToken: string;
};

export const SPIKE_SERVICE_DEFAULT = 'ws://127.0.0.1:5280/ws';
export const SPIKE_DOMAIN_DEFAULT = 'galena.localhost';
export const SPIKE_API_URL_DEFAULT = 'http://127.0.0.1:3188';

function stringValue(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  return typeof value === 'string' ? value : '';
}

export function readSpikeEnv(env: Record<string, string | undefined>): SpikeConfig {
  return {
    service: stringValue(env, 'EXPO_PUBLIC_SPIKE_SERVICE') || SPIKE_SERVICE_DEFAULT,
    domain: stringValue(env, 'EXPO_PUBLIC_SPIKE_DOMAIN') || SPIKE_DOMAIN_DEFAULT,
    apiUrl: stringValue(env, 'EXPO_PUBLIC_SPIKE_API_URL') || SPIKE_API_URL_DEFAULT,
    selfJid: stringValue(env, 'EXPO_PUBLIC_SPIKE_SELF_JID'),
    selfToken: stringValue(env, 'EXPO_PUBLIC_SPIKE_SELF_TOKEN'),
    peerJid: stringValue(env, 'EXPO_PUBLIC_SPIKE_PEER_JID'),
    peerToken: stringValue(env, 'EXPO_PUBLIC_SPIKE_PEER_TOKEN'),
  };
}

// Reads the build-time `EXPO_PUBLIC_SPIKE_*` variables. Each one must be
// referenced as its own `process.env.EXPO_PUBLIC_*` expression so that
// babel-preset-expo inlines/references it (passing the whole `process.env`
// object skips that transformation, so the values would be missing at runtime).
export function readSpikeEnvFromProcess(): SpikeConfig {
  return readSpikeEnv({
    EXPO_PUBLIC_SPIKE_SERVICE: process.env.EXPO_PUBLIC_SPIKE_SERVICE,
    EXPO_PUBLIC_SPIKE_DOMAIN: process.env.EXPO_PUBLIC_SPIKE_DOMAIN,
    EXPO_PUBLIC_SPIKE_API_URL: process.env.EXPO_PUBLIC_SPIKE_API_URL,
    EXPO_PUBLIC_SPIKE_SELF_JID: process.env.EXPO_PUBLIC_SPIKE_SELF_JID,
    EXPO_PUBLIC_SPIKE_SELF_TOKEN: process.env.EXPO_PUBLIC_SPIKE_SELF_TOKEN,
    EXPO_PUBLIC_SPIKE_PEER_JID: process.env.EXPO_PUBLIC_SPIKE_PEER_JID,
    EXPO_PUBLIC_SPIKE_PEER_TOKEN: process.env.EXPO_PUBLIC_SPIKE_PEER_TOKEN,
  });
}
