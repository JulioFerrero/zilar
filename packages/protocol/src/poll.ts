import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema, JidSchema } from './common';

const hasUniqueIds = (ids: readonly string[]): boolean => new Set(ids).size === ids.length;

export const PollOptionSchema = z.strictObject({
  id: IdSchema,
  label: z.string().min(1).max(100),
});

export type PollOption = z.infer<typeof PollOptionSchema>;

export const PollSchema = z.strictObject({
  id: IdSchema,
  question: z.string().min(1).max(300),
  options: z
    .array(PollOptionSchema)
    .min(2)
    .max(10)
    .refine((options) => hasUniqueIds(options.map((option) => option.id)), {
      message: 'poll option ids must be unique',
    }),
  multiple: z.boolean(),
  closes_at: IsoDateTimeSchema.optional(),
});

export type Poll = z.infer<typeof PollSchema>;

export const PollVoteSchema = z.strictObject({
  poll_id: IdSchema,
  option_ids: z
    .array(IdSchema)
    .min(1)
    .max(10)
    .refine((ids) => hasUniqueIds(ids), {
      message: 'poll vote option ids must be unique',
    }),
  voter: JidSchema,
});

export type PollVote = z.infer<typeof PollVoteSchema>;
