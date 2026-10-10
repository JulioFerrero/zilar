import { pointerAngle } from '../cap';
import { PROVIDERS, angleToProvider, providerAngle } from '../demo';
import { required } from './dom';

// ---------- provider selector ----------
export function initProvider(root: ParentNode): void {
  const dial = required<HTMLElement>(root, '#provider-dial');
  const knob = required<HTMLElement>(root, '#provider-knob');
  const ticks = required<HTMLElement>(root, '#provider-ticks');
  const readout = required<HTMLElement>(root, '#provider-readout');
  const note = required<HTMLElement>(root, '#provider-note');
  const capReadout = root.querySelector<HTMLElement>('#cap-readout');

  PROVIDERS.forEach((_, index) => {
    const tick = document.createElement('span');
    tick.className = 'tick tick-major';
    tick.style.setProperty('--angle', `${providerAngle(index)}deg`);
    ticks.append(tick);
  });

  let index = 1;
  function set(next: number): void {
    index = Math.min(PROVIDERS.length - 1, Math.max(0, next));
    const name = PROVIDERS[index] ?? '';
    knob.style.setProperty('--angle', `${providerAngle(index)}deg`);
    dial.setAttribute('aria-valuenow', String(index));
    dial.setAttribute('aria-valuetext', name);
    readout.textContent = name;
    const cap = capReadout?.textContent ?? '€20';
    note.textContent = `Dev-1 runs on your ${name} key, capped at ${cap} a month.`;
    dial.classList.remove('clicked');
    void dial.offsetWidth;
    dial.classList.add('clicked');
  }

  let dragged = false;
  dial.addEventListener('pointerdown', (event) => {
    dial.setPointerCapture(event.pointerId);
    dragged = false;
  });
  dial.addEventListener('pointermove', (event) => {
    if (!dial.hasPointerCapture(event.pointerId)) return;
    const box = knob.getBoundingClientRect();
    const angle = pointerAngle(
      event.clientX - (box.left + box.width / 2),
      event.clientY - (box.top + box.height / 2),
    );
    const next = angleToProvider(angle);
    if (next !== index) {
      dragged = true;
      set(next);
    }
  });
  // a tap without a drag turns the selector one detent, wrapping at the end
  dial.addEventListener('pointerup', (event) => {
    if (dial.hasPointerCapture(event.pointerId)) dial.releasePointerCapture(event.pointerId);
    if (!dragged) set(index === PROVIDERS.length - 1 ? 0 : index + 1);
  });
  dial.addEventListener('keydown', (event) => {
    const moves: Record<string, number> = {
      ArrowUp: 1,
      ArrowRight: 1,
      ArrowDown: -1,
      ArrowLeft: -1,
    };
    if (event.key === 'Home') set(0);
    else if (event.key === 'End') set(PROVIDERS.length - 1);
    else if (event.key in moves) set(index + (moves[event.key] ?? 0));
    else return;
    event.preventDefault();
  });
  root.addEventListener('capchange', () => set(index));
  set(index);
}
