// The feature instruments: an approval request with an audit printer, a routine with a
// split-flap board, a provider selector and machine pairing. Each acts out a real Zilar rule.

import { initApproval } from './instruments/approval';
import { initPairing } from './instruments/pairing';
import { initProvider } from './instruments/provider';
import { initRoutine } from './instruments/routine';
import { initSheen } from './instruments/sheen';

export function initInstruments(root: ParentNode): void {
  initApproval(root);
  initRoutine(root);
  initProvider(root);
  initPairing(root);
  initSheen(root);
}
