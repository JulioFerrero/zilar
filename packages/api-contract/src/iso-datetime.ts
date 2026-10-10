// ISO 8601 datetime with a timezone, mirroring `IsoDateTimeSchema` in
// `@zilar/protocol` (the contract depends on `effect` only, so it keeps a
// copy of the pattern). Used by the chain A groups (T-0892).

import { Schema } from 'effect';

const ISO_DATE_SOURCE =
  '(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))';
const ISO_DATETIME_PATTERN = new RegExp(
  `^${ISO_DATE_SOURCE}T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$`,
);

export const IsoDateTime = Schema.String.pipe(Schema.check(Schema.isPattern(ISO_DATETIME_PATTERN)));
