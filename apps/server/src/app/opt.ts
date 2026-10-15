/**
 * Folds a repeated optional-override guard into one helper (T-1460, plan #48):
 * `opt('now', value)` is `{ now: value }` when `value` is defined and `{}`
 * otherwise, so a route module spreads it instead of writing
 * `...(value === undefined ? {} : { key: value })` at every call site.
 */
export function opt<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<K, V>>);
}
