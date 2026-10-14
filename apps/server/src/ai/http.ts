// Small HTTP helpers shared by the model clients, the gateway and the
// connection probes. They used to live with the (now deleted) proxy admin
// client; a plain fetch type and the secret redactor are the only parts still
// needed.

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

// Redacts any exact secret the caller names, then any credential-shaped token.
// The sk- rule also catches provider keys echoed back by a provider.
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 4) {
      out = out.split(secret).join('[redacted]');
    }
  }
  return out.replace(/sk-[A-Za-z0-9_-]{4,}/g, 'sk-***');
}
