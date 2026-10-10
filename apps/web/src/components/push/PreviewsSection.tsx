import { Card, SectionLabel } from '../ui/card';
import { Switch } from '../ui/switch';

/** The "Message previews" toggle and its fixed explanation. */
export function PreviewsSection({
  showPreviews,
  onToggle,
}: {
  showPreviews: boolean;
  onToggle: (value: boolean) => void;
}) {
  return (
    <section aria-label="Message previews" className="flex flex-col gap-2">
      <SectionLabel>Message previews</SectionLabel>
      <Card className="divide-divider">
        <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
          <Switch
            checked={showPreviews}
            onCheckedChange={(value) => onToggle(value)}
            label="Show the first lines of new messages in notifications"
          />
        </div>
      </Card>
      <p className="text-[13px] text-muted-foreground">
        Off means who and where only — never message text.
      </p>
    </section>
  );
}
