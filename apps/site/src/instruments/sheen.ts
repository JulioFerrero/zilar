// ---------- light that follows the pointer across metal ----------
export function initSheen(root: ParentNode): void {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  for (const surface of root.querySelectorAll<HTMLElement>('.sheen')) {
    surface.addEventListener('pointermove', (event) => {
      const box = surface.getBoundingClientRect();
      surface.style.setProperty('--mx', `${event.clientX - box.left}px`);
      surface.style.setProperty('--my', `${event.clientY - box.top}px`);
    });
  }
}
