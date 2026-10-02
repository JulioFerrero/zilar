import { CAP, angleToCap, capLabel, capToAngle, pointerAngle, stepCap } from './cap';

// The control plate: three physical controls that act out real Zilar guarantees.

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`missing ${selector}`);
  return element;
}

function initDial(root: ParentNode): void {
  const dial = required<HTMLElement>(root, '#cap-dial');
  const knob = required<HTMLElement>(root, '#cap-knob');
  const readout = required<HTMLElement>(root, '#cap-readout');
  const note = required<HTMLElement>(root, '#cap-note');
  const ticks = required<HTMLElement>(root, '#cap-ticks');

  const tickCount = (CAP.max - CAP.min) / CAP.step + 1;
  for (let index = 0; index < tickCount; index++) {
    const tick = document.createElement('span');
    const major = index % 4 === 0 || index === tickCount - 1;
    tick.className = major ? 'tick tick-major' : 'tick';
    tick.style.setProperty('--angle', `${capToAngle(CAP.min + index * CAP.step)}deg`);
    ticks.append(tick);
  }

  let value: number = CAP.initial;
  function set(next: number): void {
    if (next === value && knob.style.getPropertyValue('--angle') !== '') return;
    value = next;
    const label = capLabel(value);
    knob.style.setProperty('--angle', `${capToAngle(value)}deg`);
    dial.setAttribute('aria-valuenow', String(value));
    dial.setAttribute('aria-valuetext', `${label} a month`);
    readout.textContent = label;
    note.textContent = `Dev-1 stops at ${label} this month, whatever it is asked to do.`;
    dial.classList.remove('clicked');
    void dial.offsetWidth;
    dial.classList.add('clicked');
  }

  function fromPointer(event: PointerEvent): void {
    const box = knob.getBoundingClientRect();
    const angle = pointerAngle(
      event.clientX - (box.left + box.width / 2),
      event.clientY - (box.top + box.height / 2),
    );
    set(angleToCap(angle));
  }

  dial.addEventListener('pointerdown', (event) => {
    dial.setPointerCapture(event.pointerId);
    dial.classList.add('grabbed');
    fromPointer(event);
  });
  dial.addEventListener('pointermove', (event) => {
    if (dial.hasPointerCapture(event.pointerId)) fromPointer(event);
  });
  const release = (event: PointerEvent) => {
    if (dial.hasPointerCapture(event.pointerId)) dial.releasePointerCapture(event.pointerId);
    dial.classList.remove('grabbed');
  };
  dial.addEventListener('pointerup', release);
  dial.addEventListener('pointercancel', release);

  dial.addEventListener('keydown', (event) => {
    const moves: Record<string, number> = {
      ArrowUp: 1,
      ArrowRight: 1,
      ArrowDown: -1,
      ArrowLeft: -1,
      PageUp: 4,
      PageDown: -4,
    };
    if (event.key === 'Home') set(CAP.min);
    else if (event.key === 'End') set(CAP.max);
    else if (event.key in moves) set(stepCap(value, moves[event.key] ?? 0));
    else return;
    event.preventDefault();
  });

  set(CAP.initial);
}

function initKill(root: ParentNode): void {
  const cover = required<HTMLButtonElement>(root, '#kill-cover');
  const toggle = required<HTMLButtonElement>(root, '#kill-switch');
  const lamp = required<HTMLElement>(root, '#kill-lamp');
  const state = required<HTMLElement>(root, '#kill-state');
  const note = required<HTMLElement>(root, '#kill-note');

  function render(): void {
    const open = cover.getAttribute('aria-expanded') === 'true';
    const stopped = toggle.getAttribute('aria-pressed') === 'true';
    toggle.disabled = !open;
    toggle.setAttribute('aria-label', stopped ? 'Run Dev-1 again' : 'Stop Dev-1');
    cover.setAttribute('aria-label', open ? 'Close the guard' : 'Lift the guard');
    lamp.classList.toggle('off', stopped);
    state.textContent = stopped ? 'Stopped' : 'Running';
    if (stopped) note.textContent = 'Dev-1 is stopped. Nothing it was doing can land afterwards.';
    else note.textContent = open ? 'Press Stop.' : 'Lift the guard, then press Stop.';
  }

  cover.addEventListener('click', () => {
    cover.setAttribute('aria-expanded', String(cover.getAttribute('aria-expanded') !== 'true'));
    render();
  });
  toggle.addEventListener('click', () => {
    toggle.setAttribute('aria-pressed', String(toggle.getAttribute('aria-pressed') !== 'true'));
    render();
  });
  render();
}

function initCopy(root: ParentNode): void {
  const button = required<HTMLButtonElement>(root, '#copy-commands');
  const code = required<HTMLElement>(root, '#commands');
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code.textContent?.trim() ?? '');
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Select and copy';
    }
    window.setTimeout(() => {
      button.textContent = 'Copy commands';
    }, 1800);
  });
}

export function initControls(root: ParentNode): void {
  initDial(root);
  initKill(root);
  initCopy(root);
}
