/** A minimal push-based async iterable used to expose native stream events as `for await` loops. */
export class Channel<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private waiting: { resolve: (result: IteratorResult<T>) => void; reject: (error: unknown) => void }[] = [];
  private done = false;
  private failure: unknown = undefined;
  private onReturn?: () => void;

  constructor(onReturn?: () => void) {
    this.onReturn = onReturn;
  }

  push(value: T): void {
    if (this.done) return;
    const waiter = this.waiting.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else this.buffer.push(value);
  }

  close(): void {
    if (this.done) return;
    this.done = true;
    for (const waiter of this.waiting.splice(0)) waiter.resolve({ value: undefined as never, done: true });
  }

  fail(error: unknown): void {
    if (this.done) return;
    this.done = true;
    this.failure = error;
    for (const waiter of this.waiting.splice(0)) waiter.reject(error);
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.buffer.length > 0) return Promise.resolve({ value: this.buffer.shift()!, done: false });
        if (this.failure !== undefined) return Promise.reject(this.failure);
        if (this.done) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
      },
      return: () => {
        // Breaking out of `for await` cancels the underlying request.
        if (!this.done) this.onReturn?.();
        this.close();
        this.buffer = [];
        return Promise.resolve({ value: undefined as never, done: true });
      },
    };
  }
}
