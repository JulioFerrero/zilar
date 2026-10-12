/**
 * A friendly device line for one stored `User-Agent` header, e.g.
 * "Chrome on macOS" or "Zilar on Android" (T-1235, shared with mobile T-1250).
 * The mobile app is the only non-browser client, so an agent that names no
 * browser is the app. An agent we cannot place at all shows "Unknown device".
 */
export function describeUserAgent(userAgent: string | null | undefined): string {
  const agent = userAgent?.trim() ?? '';
  if (agent === '') {
    return 'Unknown device';
  }
  const os = detectOs(agent);
  const client = detectClient(agent);
  if (client === 'Zilar' && os === null) {
    return 'Unknown device';
  }
  return os === null ? client : `${client} on ${os}`;
}

function detectOs(agent: string): string | null {
  if (/Android/i.test(agent)) {
    return 'Android';
  }
  if (/iPhone|iPad|iPod/i.test(agent)) {
    return 'iOS';
  }
  if (/Mac OS X|Macintosh/i.test(agent)) {
    return 'macOS';
  }
  if (/Windows/i.test(agent)) {
    return 'Windows';
  }
  if (/Linux/i.test(agent)) {
    return 'Linux';
  }
  return null;
}

function detectClient(agent: string): string {
  if (/Edg\//i.test(agent) || /EdgiOS\//i.test(agent)) {
    return 'Edge';
  }
  if (/Firefox\//i.test(agent) || /FxiOS\//i.test(agent)) {
    return 'Firefox';
  }
  // Opera carries `OPR/`; it also contains `Chrome/`, so it is checked first.
  if (/OPR\//i.test(agent)) {
    return 'Opera';
  }
  if (/Chrome\//i.test(agent) || /CriOS\//i.test(agent)) {
    return 'Chrome';
  }
  if (/Safari\//i.test(agent)) {
    return 'Safari';
  }
  return 'Zilar';
}
