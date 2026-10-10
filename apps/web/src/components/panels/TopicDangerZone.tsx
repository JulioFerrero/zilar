import { Button } from '../ui/button';

/** Make public / Make private and Archive, for managers of a non-General topic. */
export function TopicDangerZone({
  isManager,
  isPrivate,
  visibilityBusy,
  archiving,
  onMakePublic,
  onMakePrivate,
  onArchive,
}: {
  isManager: boolean;
  isPrivate: boolean;
  visibilityBusy: boolean;
  archiving: boolean;
  onMakePublic: () => void;
  onMakePrivate: () => void;
  onArchive: () => void;
}) {
  return (
    <section aria-label="Danger zone" className="flex flex-col gap-2 px-2">
      {isManager && (
        <>
          {isPrivate ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="self-start rounded-full px-4"
              disabled={visibilityBusy}
              onClick={onMakePublic}
            >
              Make public
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="self-start rounded-full px-4"
              disabled={visibilityBusy}
              onClick={onMakePrivate}
            >
              {visibilityBusy ? 'Saving…' : 'Make private'}
            </Button>
          )}
          <Button
            type="button"
            variant="destructive"
            size="lg"
            className="self-start rounded-full px-4"
            disabled={archiving}
            onClick={onArchive}
          >
            Archive topic
          </Button>
        </>
      )}
    </section>
  );
}
