import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema, JidSchema, MoneySchema } from './common';

export const ProgressSchema = z.strictObject({
  ai: JidSchema,
  task_id: IdSchema.optional(),
  stage: z.string().min(1).max(100),
  detail: z.string().max(500).optional(),
  percent: z.int().min(0).max(100).optional(),
});

export type Progress = z.infer<typeof ProgressSchema>;

export const PreviewSchema = z.strictObject({
  ai: JidSchema,
  url: z.url({ protocol: /^https?$/ }),
  label: z.string().max(100).optional(),
  expires_at: IsoDateTimeSchema.optional(),
});

export type Preview = z.infer<typeof PreviewSchema>;

export const CostTokensSchema = z.strictObject({
  input: z.int().nonnegative(),
  output: z.int().nonnegative(),
});

export type CostTokens = z.infer<typeof CostTokensSchema>;

export const CostSchema = z.strictObject({
  ai: JidSchema,
  room: JidSchema.optional(),
  amount: MoneySchema,
  tokens: CostTokensSchema.optional(),
});

export type Cost = z.infer<typeof CostSchema>;
