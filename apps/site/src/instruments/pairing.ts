import { groupHex, hexId, settle } from '../demo';
import { reducedMotion, required } from './dom';

// ---------- machine pairing ----------
export function initPairing(root: ParentNode): void {
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
