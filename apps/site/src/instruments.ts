import { pointerAngle } from './cap';
import {
  FLAP_GLYPHS,
  MAX_VERSIONS,
  PROVIDERS,
  SCHEDULES,
  TOOL_VERSIONS,
  type ScheduleId,
  type Version,
  angleToProvider,
  changedLines,
  countdown,
  flapText,
  groupHex,
  hexId,
  isScheduleId,
  providerAngle,
  revertTo,
  settle,
} from './demo';

// The feature instruments: an approval request with an audit printer, a routine with a
// split-flap board, a provider selector and machine pairing. Each acts out a real Zilar rule.

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`missing ${selector}`);
  return element;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function clockTime(date: Date): string {
  return date.toTimeString().slice(0, 8);
}

// ---------- approval ----------
function initApproval(root: ParentNode): void {
  const approve = required<HTMLButtonElement>(root, '#approve');
  const deny = required<HTMLButtonElement>(root, '#deny');
  const again = required<HTMLButtonElement>(root, '#ask-again');
  const lamp = required<HTMLElement>(root, '#request-lamp');
  const timer = required<HTMLElement>(root, '#request-timer');
  const stamp = required<HTMLElement>(root, '#request-stamp');
  const note = required<HTMLElement>(root, '#approval-note');
  const ticket = required<HTMLOListElement>(root, '#ticket');

  let requestId = '';
  let deadline = 0;
  let decided = false;

  // newest entry at the slot, older ones pushed down the paper; ids only, never content
  function print(event: string, by: string): void {
    const entry = document.createElement('li');
    const time = document.createElement('span');
    time.textContent = clockTime(new Date());
    const what = document.createElement('span');
    what.textContent = event;
    const detail = document.createElement('span');
    detail.className = 'ticket-detail';
    detail.textContent = `req ${requestId}   ${by}`;
    entry.append(time, what, detail);
    ticket.prepend(entry);
    while (ticket.children.length > 6) ticket.lastElementChild?.remove();
    if (!reducedMotion()) {
      ticket.classList.remove('feeding');
      void ticket.offsetWidth;
      ticket.classList.add('feeding');
    }
  }

  function ask(): void {
    requestId = hexId(Math.random, 8);
    deadline = Date.now() + 3600_000;
    decided = false;
    approve.disabled = false;
    deny.disabled = false;
    again.hidden = true;
    lamp.classList.remove('off');
    lamp.classList.add('pulse');
    stamp.className = 'stamp';
    stamp.textContent = '';
    note.textContent = 'Nothing happens until you press one of the two keys.';
    print('approval.requested', 'Dev-1');
  }

  function decide(approved: boolean): void {
    if (decided) return;
    decided = true;
    approve.disabled = true;
    deny.disabled = true;
    again.hidden = false;
    lamp.classList.remove('pulse');
    lamp.classList.toggle('off', !approved);
    stamp.textContent = approved ? 'Approved' : 'Denied';
    stamp.className = approved ? 'stamp stamped approved' : 'stamp stamped';
    note.textContent = approved
      ? 'Approved once. Dev-1 merges, and the decision is on the record.'
      : 'Denied. Dev-1 is told no, and the decision is on the record.';
    print(approved ? 'approval.approved' : 'approval.denied', 'you');
  }

  approve.addEventListener('click', () => decide(true));
  deny.addEventListener('click', () => decide(false));
  again.addEventListener('click', ask);

  window.setInterval(() => {
    if (!decided) timer.textContent = countdown((deadline - Date.now()) / 1000);
  }, 1000);
  ask();
}

// ---------- routine ----------
function initFlaps(board: HTMLElement): (text: string) => void {
  const cells = Array.from({ length: flapText('').length }, () => {
    const cell = document.createElement('span');
    cell.className = 'flap';
    cell.textContent = ' ';
    board.append(cell);
    return cell;
  });

  const timers: number[] = [];
  return (text: string) => {
    timers.splice(0).forEach((id) => window.clearInterval(id));
    board.setAttribute('aria-label', text.trim());
    [...flapText(text)].forEach((target, index) => {
      const cell = cells[index];
      if (!cell || cell.textContent === target) return;
      if (reducedMotion()) {
        cell.textContent = target;
        return;
      }
      // each cell clatters through a few glyphs, left to right, then lands
      let turns = 3 + index;
      const id = window.setInterval(() => {
        cell.classList.remove('turn');
        void cell.offsetWidth;
        cell.classList.add('turn');
        turns -= 1;
        cell.textContent =
          turns <= 0
            ? target
            : (FLAP_GLYPHS[Math.floor(Math.random() * FLAP_GLYPHS.length)] ?? ' ');
        if (turns <= 0) window.clearInterval(id);
      }, 55);
      timers.push(id);
    });
  };
}

function initRoutine(root: ParentNode): void {
  const setFlaps = initFlaps(required<HTMLElement>(root, '#flaps'));
  const lever = required<HTMLButtonElement>(root, '#routine-lever');
  const lamp = required<HTMLElement>(root, '#routine-lamp');
  const state = required<HTMLElement>(root, '#routine-state');
  const note = required<HTMLElement>(root, '#routine-note');
  const presets = [...root.querySelectorAll<HTMLButtonElement>('.preset')];

  let schedule: ScheduleId = 'daily';
  let running = true;

  function render(): void {
    lever.setAttribute('aria-checked', String(running));
    lever.setAttribute('aria-label', running ? 'Routine running' : 'Routine paused');
    lamp.classList.toggle('off', !running);
    state.textContent = running ? 'On' : 'Off';
    for (const preset of presets) {
      preset.setAttribute('aria-pressed', String(preset.dataset.schedule === schedule));
      preset.disabled = !running;
    }
    setFlaps(running ? SCHEDULES[schedule].flap : 'PAUSED');
    note.textContent = running
      ? SCHEDULES[schedule].note
      : 'Paused. Nothing posts until you switch it back on.';
  }

  for (const preset of presets) {
    preset.addEventListener('click', () => {
      if (isScheduleId(preset.dataset.schedule)) schedule = preset.dataset.schedule;
      render();
    });
  }
  lever.addEventListener('click', () => {
    running = !running;
    render();
  });
  render();
  initVersions(root);
}

function initVersions(root: ParentNode): void {
  const tabs = required<HTMLElement>(root, '#version-tabs');
  const title = required<HTMLElement>(root, '#version-title');
  const code = required<HTMLOListElement>(root, '#version-code');
  const revert = required<HTMLButtonElement>(root, '#revert');

  let versions: readonly Version[] = TOOL_VERSIONS;
  let selected = versions.at(-1)?.n ?? 1;

  function render(): void {
    tabs.replaceChildren(
      ...versions.map((version) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'version-tab';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(version.n === selected));
        tab.setAttribute('aria-controls', 'version-panel');
        tab.textContent = `v${version.n}`;
        tab.addEventListener('click', () => {
          selected = version.n;
          render();
        });
        return tab;
      }),
    );

    const index = versions.findIndex((version) => version.n === selected);
    const version = versions[index];
    if (!version) return;
    title.textContent = version.title;
    const changed = changedLines(versions[index - 1]?.code, version.code);
    code.replaceChildren(
      ...version.code.map((line, lineIndex) => {
        const item = document.createElement('li');
        item.textContent = line;
        if (changed[lineIndex]) item.className = 'changed';
        return item;
      }),
    );

    const latest = version === versions.at(-1);
    revert.disabled = latest || versions.length >= MAX_VERSIONS;
    revert.textContent = latest ? 'Current version' : `Revert to v${version.n}`;
  }

  revert.addEventListener('click', () => {
    const next = revertTo(versions, selected);
    if (next === versions) return;
    versions = next;
    selected = next.at(-1)?.n ?? selected;
    render();
  });
  render();
}

// ---------- provider selector ----------
function initProvider(root: ParentNode): void {
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

// ---------- machine pairing ----------
function initPairing(root: ParentNode): void {
  const button = required<HTMLButtonElement>(root, '#pair');
  const runner = required<HTMLElement>(root, '#print-runner');
  const zilar = required<HTMLElement>(root, '#print-zilar');
  const lamp = required<HTMLElement>(root, '#machine-lamp');
  const state = required<HTMLElement>(root, '#machine-state');
  const note = required<HTMLElement>(root, '#pair-note');

  type Step = 'idle' | 'checking' | 'matched' | 'online';
  let step: Step = 'idle';
  const blank = '---- ---- ----';

  function render(): void {
    const texts: Record<Step, [string, string]> = {
      idle: ['Pair dev-mac', 'Run the runner on your Mac, then pair it here.'],
      checking: ['Checking', 'Both sides compute the fingerprint of the same key.'],
      matched: ['Approve', 'They match. Approve only a machine you just paired yourself.'],
      online: ['Revoke', 'dev-mac is online. Dev-1 can work there until you revoke it.'],
    };
    const [label, text] = texts[step];
    button.textContent = label;
    button.disabled = step === 'checking';
    note.textContent = text;
    lamp.classList.toggle('off', step !== 'online');
    state.textContent = step === 'online' ? 'dev-mac online' : 'dev-mac';
    runner.classList.toggle('match', step === 'matched' || step === 'online');
    zilar.classList.toggle('match', step === 'matched' || step === 'online');
  }

  function check(): void {
    step = 'checking';
    render();
    const print = groupHex(hexId(Math.random, 12));
    if (reducedMotion()) {
      runner.textContent = print;
      zilar.textContent = print;
      step = 'matched';
      render();
      return;
    }
    // the runner shows its print at once; Zilar's side settles on the same value, left to right
    runner.textContent = print;
    let revealed = 0;
    const id = window.setInterval(() => {
      revealed += 1;
      zilar.textContent = settle(print, revealed, Math.random);
      if (revealed >= print.length) {
        window.clearInterval(id);
        step = 'matched';
        render();
      }
    }, 70);
  }

  button.addEventListener('click', () => {
    if (step === 'idle') check();
    else if (step === 'matched') step = 'online';
    else if (step === 'online') {
      step = 'idle';
      runner.textContent = blank;
      zilar.textContent = blank;
    }
    render();
  });
  render();
}

// ---------- light that follows the pointer across metal ----------
function initSheen(root: ParentNode): void {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  for (const surface of root.querySelectorAll<HTMLElement>('.sheen')) {
    surface.addEventListener('pointermove', (event) => {
      const box = surface.getBoundingClientRect();
      surface.style.setProperty('--mx', `${event.clientX - box.left}px`);
      surface.style.setProperty('--my', `${event.clientY - box.top}px`);
    });
  }
}

export function initInstruments(root: ParentNode): void {
  initApproval(root);
  initRoutine(root);
  initProvider(root);
  initPairing(root);
  initSheen(root);
}
