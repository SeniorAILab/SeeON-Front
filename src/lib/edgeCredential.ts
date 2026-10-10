export class OneTimeCredential {
  #value: string | null;

  constructor(value: string) {
    this.#value = value;
  }

  consume(): string | null {
    const value = this.#value;
    this.clear();
    return value;
  }

  clear(): void {
    this.#value = null;
  }

  dispose(): void {
    this.clear();
  }

  toJSON(): null {
    return null;
  }
}

export class EdgeEnrollmentResponseError extends Error {
  readonly name = "EdgeEnrollmentResponseError";

  constructor(readonly reason: string) {
    super(`Malformed edge enrollment response: ${reason}`);
  }
}
