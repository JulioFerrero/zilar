// Effect structs are readonly by default; the web mock backend and some stores edit response objects, so their shapes use this.
// It is a type-level difference only: encoding and decoding are unchanged.

import { Schema } from 'effect';

type MutableFields<F extends Schema.Struct.Fields> = {
  readonly [K in keyof F]: Schema.mutableKey<F[K]>;
};

export function mutableStruct<const F extends Schema.Struct.Fields>(
  fields: F,
): Schema.Struct<MutableFields<F>> {
  const wrapped: Record<string, Schema.Constraint> = {};
  for (const [key, value] of Object.entries(fields)) {
    wrapped[key] = Schema.mutableKey(value);
  }
  return Schema.Struct(wrapped as MutableFields<F>);
}
