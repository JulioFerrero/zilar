// A payload field that is `undefined` means "leave it untouched", and the
// hand-written clients never sent it (`JSON.stringify` drops it). The JSON
// codec of a nullable optional field would encode an explicit `undefined` as
// `null`, which clears the field on the server. A client passes its input
// through this helper so only the keys it really set reach the encoder.
// Used by the chain A groups (T-0892).

export type DefinedFields<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

export function omitUndefined<T extends object>(value: T): DefinedFields<T> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (field !== undefined) {
      out[key] = field;
    }
  }
  return out as DefinedFields<T>;
}
