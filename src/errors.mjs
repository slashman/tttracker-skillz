/**
 * Every failure that reaches the CLI boundary should be a TrackerError, so the
 * JSON envelope can carry an actionable `hint` alongside the message. Anything
 * else is a bug and is reported as such rather than dressed up as user error.
 */
export class TrackerError extends Error {
  constructor(message, { hint = null, data = null } = {}) {
    super(message)
    this.name = 'TrackerError'
    this.hint = hint
    this.data = data
  }
}

export function fail(message, opts) {
  throw new TrackerError(message, opts)
}
