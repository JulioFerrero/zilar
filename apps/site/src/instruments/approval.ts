import { countdown, hexId } from '../demo';
import { clockTime, reducedMotion, required } from './dom';

// ---------- approval ----------
export function initApproval(root: ParentNode): void {
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
