import type { Money } from '@zilar/protocol';

/** `€0.02`; falls back to `EUR 0.02` when the runtime has no currency formatting. */
export function formatMoney(money: Money): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: money.currency }).format(
      money.amount,
    );
  } catch {
    return `${money.currency} ${money.amount.toFixed(2)}`;
  }
}
