import { TextInput } from '@/components/ui/text-input';
import { FieldError } from './AiPageShell';

/** Step 5: the USD daily and monthly caps, with the server's validation rules. */
export function LimitsFields({
  day,
  month,
  dayError,
  monthError,
  onDayChange,
  onMonthChange,
}: {
  day: string;
  month: string;
  dayError: string;
  monthError: string;
  onDayChange: (value: string) => void;
  onMonthChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-[14px] font-medium">Per day (USD)</span>
        <div className="flex items-center gap-2">
          <span className="text-[15px] text-muted-foreground">$</span>
          <TextInput
            aria-label="Per day amount"
            inputMode="decimal"
            value={day}
            onChange={(event) => onDayChange(event.target.value)}
            placeholder="2"
            className="w-32"
          />
        </div>
        {dayError !== '' && <FieldError>{dayError}</FieldError>}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[14px] font-medium">Per month (USD)</span>
        <div className="flex items-center gap-2">
          <span className="text-[15px] text-muted-foreground">$</span>
          <TextInput
            aria-label="Per month amount"
            inputMode="decimal"
            value={month}
            onChange={(event) => onMonthChange(event.target.value)}
            placeholder="20"
            className="w-32"
          />
        </div>
        {monthError !== '' && <FieldError>{monthError}</FieldError>}
      </label>

      <p className="text-[13px] text-muted-foreground">
        Amounts are in USD. The monthly cap is what the AI's provider key can spend.
      </p>
    </div>
  );
}
