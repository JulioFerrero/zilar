// The protocol version this code speaks, reported in `/health` as `protocolVersion`; it changes whenever the client/server contract changes.
export const protocolVersion = '0.2.0';

// The oldest client protocol the server still accepts, reported in `/health` as `minClientProtocol`;
// an older client shows an "update the app" banner. Raise it only on a breaking API change.
export const minClientProtocol = '0.2.0';

// Both are dotted numeric strings; a part that is not a number counts as `0`, so a malformed version is treated as the oldest possible one.
export function isClientOutdated(clientVersion: string, minimumVersion: string): boolean {
  const client = versionParts(clientVersion);
  const minimum = versionParts(minimumVersion);
  const length = Math.max(client.length, minimum.length);
  for (let index = 0; index < length; index += 1) {
    const left = client[index] ?? 0;
    const right = minimum[index] ?? 0;
    if (left !== right) {
      return left < right;
    }
  }
  return false;
}

function versionParts(version: string): number[] {
  return version.split('.').map((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isFinite(value) ? value : 0;
  });
}
