export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

// Redacts each named secret (4+ chars), then any credential-shaped token,
// including provider keys a provider echoes back.
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 4) {
      out = out.split(secret).join('[redacted]');
    }
  }
  return out.replace(/sk-[A-Za-z0-9_-]{4,}/g, 'sk-***');
}
