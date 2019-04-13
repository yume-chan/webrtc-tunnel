export default class MultiMap<TKey, TValue> {
    private _map: Map<TKey, TValue[]> = new Map();

    public keys(): TKey[] {
        return Array.from(this._map.keys());
    }

    public get(key: TKey): TValue[] {
        return this._map.get(key) || [];
    }

    public add(key: TKey, value: TValue): void {
        if (!this._map.has(key)) {
            this._map.set(key, []);
        }

        this._map.get(key)!.push(value);
    }

    public removeKey(key: TKey): boolean {
        if (!this._map.has(key)) {
            return false;
        }

        this._map.delete(key);
        return true;
    }

    public remove(key: TKey, value: TValue): boolean {
        if (!this._map.has(key)) {
            return false;
        }

        const array = this._map.get(key)!;
        const index = array.indexOf(value);

        if (index === -1) {
            return false;
        }

        array.splice(index, 1);
        return true;
    }
}
