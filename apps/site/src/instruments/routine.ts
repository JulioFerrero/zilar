import {
  FLAP_GLYPHS,
  MAX_VERSIONS,
  SCHEDULES,
  TOOL_VERSIONS,
  type ScheduleId,
  type Version,
  changedLines,
  flapText,
  isScheduleId,
  revertTo,
} from '../demo';
import { reducedMotion, required } from './dom';

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

export function initRoutine(root: ParentNode): void {
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
