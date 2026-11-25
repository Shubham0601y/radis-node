export class RadisError extends Error {
  constructor(message, { status = null, code = null, details = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "RadisError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class RadisNetworkError extends RadisError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "RadisNetworkError";
  }
}
