// The landing head script adds `anim` to <html> before paint. If the bundle then never runs,
// the pinned CSS would keep the scripts-only layout, so the head script removes `anim` again
// unless this flag is set on mount.
declare global {
  interface Window {
    __zilarReady?: boolean;
  }
}

export function markReady(): void {
  window.__zilarReady = true;
}
