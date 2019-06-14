import AsyncOperationManager, { PromiseResolver } from "../src/async-operation-manager";

describe('promise resolver', () => {
    test('resolve void', () => {
        const resolver = new PromiseResolver<void>();

        expect(resolver.state).toBe('running');

        resolver.resolve();

        expect(resolver.state).toBe('resolved');
        expect(resolver.promise).resolves.toBe(undefined);
    });

    test('resolve value', () => {
        const resolver = new PromiseResolver<number>();

        resolver.resolve(42);

        expect(resolver.state).toBe('resolved');
        expect(resolver.promise).resolves.toBe(42);
    });

    test('reject', () => {
        const resolver = new PromiseResolver<void>();

        const message = Date.now().toString();
        resolver.reject(new Error(message));

        expect(resolver.state).toBe('rejected');
        expect(resolver.promise).rejects.toHaveProperty('message', message);
    })
});

describe('async operation manager', () => {
    test('resolve', () => {
        const manager = new AsyncOperationManager();
        const { id, promise } = manager.add<number>();

        expect(id).toEqual(expect.any(Number));
        expect(promise).toEqual(expect.any(Promise));

        manager.resolve(id, 42);

        expect(promise).resolves.toBe(42);
    });

    test('resolve non-exist operation', () => {
        const manager = new AsyncOperationManager();
        manager.resolve(0, 42);
    });

    test('reject', () => {
        const manager = new AsyncOperationManager();

        const { id, promise } = manager.add<number>();

        const message = Date.now().toString();
        manager.reject(id, new Error(message));

        expect(promise).rejects.toHaveProperty('message', message);
    });
});
