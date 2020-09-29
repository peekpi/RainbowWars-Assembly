import { storage } from "near-sdk-as";
import { ContractPromiseBatch, u128, u256 } from "near-sdk-as";
import { context, util, math, env } from "near-sdk-as";

export class Address extends u256 {
    private accountName: string
    constructor(account: string) {
        super();
        this.accountName = account;
        if(account.length > 0) {
            const accountBytes = util.stringToBytes(this.account);
            const hashBytes = math.keccak256(accountBytes);
            this.set(u256.fromUint8ArrayBE(hashBytes));
        }
    }
    static fromU256(add: u256): Address {
        const ret: Address = new Address("");
        ret.set(add);
        return ret;
    }
    transfer(amount: u256): ContractPromiseBatch {
        return ContractPromiseBatch.create(this.account).transfer(amount.as<u128>());
    }
    get account(): string {
        return this.accountName;
    }
    get balance(): u128 {
        throw "wrong!";
        return context.accountBalance(); // how to get the contract's balance
    }
}

class Msg {
    get sender(): Address {
        return new Address(context.sender);
    }
    get value(): u256 {
        return u256.fromU128(context.attachedDeposit);
    }
}

class Block {
    get number(): u256 {
        return u256.fromU64(context.blockIndex);
    }
    get timestamp(): u256 {
        return u256.fromU64(context.blockTimestamp)
    }
}


interface AbiElem {
    encode(): Uint8Array;
    encodePacked(): Uint8Array;
}

// only support u256 u128
class AE<T> implements AbiElem {
    private value: T;
    constructor(v: T) {
        this.value = v;
    }
    encode(): Uint8Array {
        const en = this.encodePacked();
        if (en.length == 32) return en;
        const enbuf = new Uint8Array(32);
        enbuf.set(en, enbuf.length - en.length);
        return enbuf;
    }
    encodePacked(): Uint8Array {
        return this.value.toUint8Array().reverse();
    }
}

export class SolAbi {
    private elems: AbiElem[] = [];
    append<T>(val: T): this {
        this.elems.push(new AE<T>(val));
        return this;
    }
    encodePacked(): Uint8Array {
        const enbuf = new Uint8Array(this.elems.length * 32);
        let size = 0;
        // forEach and map don't work. maybe a bug of compiler.
        for (let i = 0; i < this.elems.length; i++) {
            const elem = this.elems[i];
            const en = elem.encodePacked();
            enbuf.set(en, size);
            size += en.length;
        }
        return enbuf.subarray(0, size);
    }
    encode(): Uint8Array {
        const enbuf = new Uint8Array(this.elems.length * 32);
        // forEach and map don't work. maybe a bug of compiler.
        for (let i = 0; i < this.elems.length; i++) {
            const elem = this.elems[i];
            const en = elem.encode();
            enbuf.set(en, i * 32);
        }
        return enbuf;
    }

}

const commonPrefix = "/14::";

// only support T=>u256
export class StorageMap<K, V> {
    private _elementPrefix: string;
    static _KEY_ELEMENT_SUFFIX: string = commonPrefix + "storage::";
    private zero: V
    constructor(prefix: string, defaultValue: V) {
        this._elementPrefix = prefix + StorageMap._KEY_ELEMENT_SUFFIX;
        this.zero = defaultValue;
    }

    /**
    * @returns An internal string key for a given key of type K.
    */
    private _key(key: K): string {
        //@ts-ignore: TODO: Add interface that forces all K types to have toString
        return this._elementPrefix + key.toString();
    }

    contains(key: K): bool {
        return storage.contains(this._key(key));
    }

    delete(key: K): void {
        storage.delete(this._key(key));
    }

    get(key: K): V {
        const _key = this._key(key);

        //return <T>storage.get(this.key, <T>this.zero);
        if (this.zero instanceof u256) {
                const value = storage.getBytes(_key);
                return value === null ? this.zero : u256.fromBytes(<Uint8Array>value);
        }
        const value = storage.getSome<V>(_key);
        return value === null ? this.zero : value;
    }
    set(key: K, value: V): void {
        const _key = this._key(key);
        if (value instanceof u256){
            storage.setBytes(_key, (<u256>value).toUint8Array());
        }
        else{
            storage.set(_key, value);
        }
    }
}

export class StorageVector<T> {
    static _KEY_ELEMENT_SUFFIX: string = commonPrefix + "storage::";
    static _KEY_LENGTH_SUFFIX: string = commonPrefix + "legnth::";
    private _elementPrefix: string;
    private _lengthKey: string;
    private _length: i32;
    private zero:T;

    /** @ignore */
    [key: number]: T;

    constructor(prefix: string, zeroValue:T) {
        this._lengthKey = prefix + StorageVector._KEY_LENGTH_SUFFIX;
        this._elementPrefix = prefix + StorageVector._KEY_ELEMENT_SUFFIX;
        this._length = -1;
        this.zero = zeroValue;
    }

    @inline
    private _key(index: i32): string {
        return this._elementPrefix + index.toString();
    }

    //@ts-ignore TS doesn't like property accessors with different levels of visibility
    get length(): i32 {
        if (this._length < 0) {
            this._length = storage.getPrimitive<i32>(this._lengthKey, 0);
        }
        return this._length;
    }

    /**
    * Internally sets the length of the vector
    * @internal
    */
    //@ts-ignore TS doesn't like property accessors with different levels of visibility
    private set length(value: i32) {
        this._length = value;
        storage.set<i32>(this._lengthKey, value);
    }

    containsIndex(index: i32): bool {
        return index >= 0 && index < this.length;
    }


    private __unchecked_get(index: i32): T {
        const _key = this._key(index);
        //return <T>storage.get(this.key, <T>this.zero);
        if (storage.hasKey(_key)) {
            if (this.zero instanceof u256) {
                const value = storage.getBytes(_key);
                return u256.fromBytes(<Uint8Array>value);
            }
            return storage.getSome<T>(_key);
        }
        return this.zero;
    }
    private __unchecked_set(index: i32, value: T): void {
        const _key = this._key(index);
        if (value instanceof u256)
            storage.setBytes(_key, (<u256>value).toUint8Array());
        else
            storage.set(_key, value);
    }

    @operator("[]")
    private __get(index: i32): T {
        assert(this.containsIndex(index), "Index out of range");
        return this.__unchecked_get(index);
    }

    @operator("[]=")
    private __set(index: i32, value: T): void {
        assert(this.containsIndex(index), "Index out of range");
        this.__unchecked_set(index, value);
    }
    push(element: T): i32 {
        let index = this.length;
        this.length = index + 1;
        this.__unchecked_set(index, element);
        return index;
    }
}

export class StorageValue<T> {
    static pos: u32 = 0
    private key: string
    private zero: T
    constructor(zeroValue: T) {
        this.key = commonPrefix + StorageValue.pos.toString();
        StorageValue.pos++;
        this.zero = zeroValue;
    }
    get value(): T {
        //return <T>storage.get(this.key, <T>this.zero);
        if (storage.hasKey(this.key)) {
            if (this.zero instanceof u256) {
                const value = storage.getBytes(this.key);
                return u256.fromBytes(<Uint8Array>value);
            }
            return storage.getSome<T>(this.key);
        }
        return this.zero;
    }
    set value(v: T) {
        if (v instanceof u256)
            storage.setBytes(this.key, (<u256>v).toUint8Array());
        else
            storage.set(this.key, v);
    }
}

function PANIC<T = string>(msg: T): void {
    let msg_encoded: Uint8Array;
    if (isString<T>()) {
        //@ts-ignore
        let message = msg.toString();
        msg_encoded = util.stringToBytes(message);
    } else {
        msg_encoded = encode<T>(msg);
    }
    env.panic_utf8(msg_encoded.byteLength, msg_encoded.dataStart);
}


function RETURN<T = string>(msg: T): void {
    let msg_encoded: Uint8Array;
    if (isString<T>()) {
        //@ts-ignore
        let message = msg.toString();
        msg_encoded = util.stringToBytes(message);
    } else {
        msg_encoded = encode<T>(msg);
    }
    env.value_return(msg_encoded.byteLength, msg_encoded.dataStart);
}

export const _require = (condition: bool, error: string = ''): void => { if (!condition) PANIC(error); }
export const _revert = (error: string): void => { PANIC(error); }
export const msg = new Msg();
export const block = new Block();