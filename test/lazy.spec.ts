import Lazy from "../src/lazy";

describe('lazy', () => {
    test('new', () => {
        const creator = jest.fn(() => 42);
        new Lazy(creator);

        expect(creator).toBeCalledTimes(0);
    });

    test('.get() once', () => {
        const creator = jest.fn(() => 42);
        const lazy: Lazy<number> = new Lazy(creator);
        const value = lazy.get();

        expect(creator).toBeCalledTimes(1);
        expect(value).toBe(42);
    });

    test('.get() multiple times', () => {
        const creator = jest.fn(() => 42);
        const lazy: Lazy<number> = new Lazy(creator);

        for (let i = 0; i < 100; i++) {
            lazy.get();
        }

        const value = lazy.get();

        expect(creator).toBeCalledTimes(1);
        expect(value).toBe(42);
    });

    test('.hasValue initial false', () => {
        const creator = jest.fn(() => 42);
        const lazy: Lazy<number> = new Lazy(creator);

        expect(lazy.hasValue).toBe(false);
    });

    test('.hasValue true after get()', () => {
        const creator = jest.fn(() => 42);
        const lazy: Lazy<number> = new Lazy(creator);
        lazy.get();

        expect(lazy.hasValue).toBe(true);
    });
})
