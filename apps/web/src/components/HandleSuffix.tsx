/**
 * The `@handle` next to a display name, when the person has one. Used in
 * member lists and profile cards where a name is shown (T-0163).
 */
export function HandleSuffix({ handle }: { handle: string | null | undefined }) {
  if (handle === null || handle === undefined || handle === '') {
    return null;
  }
  return <span className="font-normal text-muted-foreground">@{handle}</span>;
}
