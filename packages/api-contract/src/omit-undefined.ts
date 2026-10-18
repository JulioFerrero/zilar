// `undefined` means "leave it untouched", but the JSON codec would encode it as `null` and clear the field,
// so a client passes its input through this helper and only the keys it really set reach the encoder.

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
