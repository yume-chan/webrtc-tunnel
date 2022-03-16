import { PromiseResolver } from "@yume-chan/async";

const resolvedPromise = Promise.resolve();

class AsyncMutex {
    private static resolved = Promise.resolve();

    private _queue: PromiseResolver<void>[] = [];

    private _set: boolean = false;

    public wait(): Promise<void> {
        if (this._set) {
            this._set = false;
            return AsyncMutex.resolved;
        }

        const resolver = new PromiseResolver<void>();
        this._queue.push(resolver);
        return resolver.promise;
    }

    public set(): void {
        if (this._queue.length) {
            this._queue.shift()!.resolve();
            return;
        }

        this._set = true;
    }
}

class ManualResetEvent {
    private _set: boolean = false;

    private _pending: PromiseResolver<void>[] = [];

    public wait(): Promise<void> {
        if (this._set) {
            return resolvedPromise;
        }

        const resolver = new PromiseResolver<void>();
        this._pending.push(resolver);
        return resolver.promise;
    }

    public set(): void {
        this._set = true;

        for (const resolver of this._pending) {
            resolver.resolve();
        }
        this._pending = [];
    }

    public unset(): void {
        this._set = false;
    }
}

class ConditionVariable {
    private static resolvedPromise = Promise.resolve();

    private _queue: Array<() => void> = [];

    private _condition: () => boolean;

    constructor(condition: () => boolean) {
        this._condition = condition;
    }

    public wait(): Promise<void> {
        if (this._condition()) {
            return ConditionVariable.resolvedPromise;
        }

        const promise = new Promise<void>(resolve => {
            this._queue.push(resolve);
        });
        return promise;
    }

    public notify() {
        if (this._queue.length === 0) {
            return;
        }

        if (!this._condition()) {
            return;
        }

        this._queue.shift()!();
    }
}
