// effect-plain: the sidecar's egress registrar; on provision it mints a
// per-desk proxy credential, registers it with the proxy and returns the URL
// the jail gets; on stop it unregisters. A host daemon, no Effect runtime.
import { randomBytes } from 'node:crypto';
import { createRegistryClient, type RegistryClient } from '../egress/registry';
import type { EgressSettings } from './config';

/** The sidecar's view of the proxy registry plus the per-desk URL builder. */
export interface EgressRegistrar {
  /** Registers the desk and returns its per-desk proxy URL. */
  register(deskId: string, allowedHosts: readonly string[] | null): Promise<string>;
  unregister(deskId: string): Promise<void>;
}

/** Builds `http://<deskId>:<secret>@<proxy host:port>`, the jail's proxy URL. */
export function proxyUrlFor(base: string, deskId: string, secret: string): string {
  const url = new URL(base);
  url.username = deskId;
  url.password = secret;
  return url.toString();
}

/**
 * Keeps one secret per desk for this process's lifetime, so a re-provision of a
 * live desk re-registers with the same credential the jail already carries.
 */
export function createEgressRegistrar(
  settings: EgressSettings,
  client: RegistryClient = createRegistryClient(settings.registrySocket),
): EgressRegistrar {
  const secrets = new Map<string, string>();
  return {
    async register(deskId, allowedHosts) {
      const secret = secrets.get(deskId) ?? randomBytes(24).toString('base64url');
      secrets.set(deskId, secret);
      await client.register({ deskId, secret, allowedHosts });
      return proxyUrlFor(settings.proxyUrl, deskId, secret);
    },
    async unregister(deskId) {
      secrets.delete(deskId);
      await client.unregister(deskId);
    },
  };
}
