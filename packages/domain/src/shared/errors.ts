/** Base class for violations of business rules. Adapters map these to HTTP / UI errors. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}
