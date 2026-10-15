/** The tunnel died (or never existed) while a stream was using it. Never hangs: always thrown. */
export class TunnelClosedError extends Error {
  constructor(reason: string) {
    super(`tunnel closed: ${reason}`);
    this.name = 'TunnelClosedError';
  }
}
