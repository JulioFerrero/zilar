// A routine summary arrives as `<title> · <schedule>`; split at the LAST " · " because a title may itself contain one.
// A routine summary without the separator returns null, so the card keeps drawing it as one line.
export function routineCardTitle(
  action: string,
  summary: string,
): { title: string; schedule: string } | null {
  if (action !== 'routine.schedule') {
    return null;
  }
  const at = summary.lastIndexOf(' · ');
  if (at === -1) {
    return null;
  }
  return { title: summary.slice(0, at), schedule: summary.slice(at + 3) };
}
