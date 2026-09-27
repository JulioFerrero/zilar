import { z } from 'zod';

// Bare JIDs only (`local@domain`); full JIDs with a resource are not accepted by design.
export const JidSchema = z
  .string()
  .min(1)
  .max(3071)
  .refine((value) => value.split('@').length === 2, {
    message: 'a JID must contain exactly one @',
  })
  .refine((value) => !/\s/.test(value), {
    message: 'a JID must not contain whitespace',
  });

export type Jid = z.infer<typeof JidSchema>;

export const IdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._~-]+$/);

export type Id = z.infer<typeof IdSchema>;

export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

export const CurrencySchema = z.enum(['EUR', 'USD']);

export type Currency = z.infer<typeof CurrencySchema>;

export const MoneySchema = z.strictObject({
  currency: CurrencySchema,
  amount: z.number().nonnegative(),
});

export type Money = z.infer<typeof MoneySchema>;

export const BudgetSchema = z.strictObject({
  currency: CurrencySchema,
  max: z.number().positive(),
});

export type Budget = z.infer<typeof BudgetSchema>;

export const ArtifactKindSchema = z.enum([
  'message',
  'screenshot',
  'pr',
  'preview',
  'file',
  'report',
]);

export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const ArtifactRefSchema = z.strictObject({
  kind: ArtifactKindSchema,
  ref: z.union([IdSchema, z.url({ protocol: /^https?$/ }).max(2048)]),
});

export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
