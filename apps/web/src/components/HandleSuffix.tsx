export function HandleSuffix({ handle }: { handle: string | null | undefined }) {
  if (handle === null || handle === undefined || handle === '') {
    return null;
  }
  return <span className="font-normal text-muted-foreground">@{handle}</span>;
}
