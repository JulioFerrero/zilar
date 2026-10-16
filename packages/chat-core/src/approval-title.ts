/**
 * T-1723: a routine approval card's summary arrives as `<title> · <schedule>`
 * (the server's `routine.schedule` adapter joins them with " · ", e.g.
 * `Prices · every 5 minutes`). The card draws the title and the schedule
 * apart, so split the summary at the LAST " · " -- a title may itself contain
 * one. Every other action, and a routine summary without the separator,
 * returns null so the card keeps drawing the summary as one line.
 */
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
