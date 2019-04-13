export default class Lazy<T>{
    private _creator: () => T;

    private _value: T | undefined;

    private _hasValue: boolean = false;
    public get hasValue(): boolean { return this._hasValue; }

    public constructor(creator: () => T) {
        this._creator = creator;
    }

    public get() {
        if (!this._hasValue) {
            this._value = this._creator();
            this._hasValue = true;
        }

        return this._value;
    }
}
