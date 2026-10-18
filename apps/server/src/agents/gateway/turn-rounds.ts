// A turn with the AI's computer on needs computer-sized limits: a job writes,
// installs, runs, fixes and re-runs before it can answer. A non-desk turn keeps
// exactly what the gateway configured; a desk turn gets at least
// `COMPUTER_TURN_MAX_ROUNDS` rounds plus `COMPUTER_TURN_CAPS`.
import { COMPUTER_TURN_CAPS, COMPUTER_TURN_MAX_ROUNDS, type TurnCaps } from '../tool-loop';

export function turnLimits(
  configured: number | undefined,
  deskEnabled: boolean,
): { maxRounds?: number; caps?: TurnCaps } {
  if (!deskEnabled) {
    return configured === undefined ? {} : { maxRounds: configured };
  }
  return {
    maxRounds: Math.max(configured ?? 1, COMPUTER_TURN_MAX_ROUNDS),
    caps: COMPUTER_TURN_CAPS,
  };
}
