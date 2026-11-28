export class RadisError extends Error {
  constructor(message, { status = null, cause, error = null } = {}) {
    super(message, cause ? { cause } : undefined);

    this.name = "RadisError";
    this.error = error;

    if (cause) {
      this.cause = cause;
    }
  }
}

export class RadisNetworkError extends RadisError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "RadisNetworkError";
  }
}
