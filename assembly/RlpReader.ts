import { u256 } from "near-sdk-as";
import { _require } from "./Solidity";

export namespace RlpReader {

export class RLPItem {
    private static STRING_SHORT_START: u8 = 0x80;
    private static STRING_LONG_START: u8 = 0xb8;
    private static LIST_SHORT_START: u8 = 0xc0;
    private static LIST_LONG_START: u8 = 0xf8;

    private buffer:Uint8Array

    constructor(_buffer: Uint8Array) {
        this.buffer = _buffer;
    }

    // @return entire rlp item byte length
    private static itemLength(buffer: Uint8Array) : u32 {
        
        const byte0 = buffer[0];

        if (byte0 < RLPItem.STRING_SHORT_START)
            return 1;

        else if (byte0 < RLPItem.STRING_LONG_START)
            return byte0 - RLPItem.STRING_SHORT_START + 1;

        else if (byte0 < RLPItem.LIST_SHORT_START) {
            const byteLen = byte0 - RLPItem.STRING_LONG_START + 1;
            const lenBuffer = buffer.subarray(1, byteLen+1);
            let len:u32 = 0;
            for(let i = 0; i < lenBuffer.length; i++){
                len <<= 8;
                len |= lenBuffer[i];
            }
            return len + byteLen + 1;
        }

        else if (byte0 < RLPItem.LIST_LONG_START) {
            return byte0 - RLPItem.LIST_SHORT_START + 1;
        }

        else {
            const byteLen = byte0 - RLPItem.LIST_LONG_START + 1;
            const lenBuffer = buffer.subarray(1, byteLen+1);
            let len:u32 = 0;
            for(let i = 0; i < lenBuffer.length; i++){
                len <<= 8;
                len |= lenBuffer[i];
            }
            return len + byteLen + 1;
        }
    }

    rlpLen(): u32 {
        return this.buffer.length;
    }
    payloadLen(): u32 {
        return this.rlpLen() - this.payloadOffset();
    }

    private payloadOffset(): u32 {
        const byte0 = this.buffer[0];
        if (byte0 < RLPItem.STRING_SHORT_START)
            return 0;
        else if (byte0 < RLPItem.STRING_LONG_START || (byte0 >= RLPItem.LIST_SHORT_START && byte0 < RLPItem.LIST_LONG_START))
            return 1;
        else if (byte0 < RLPItem.LIST_SHORT_START)  // being explicit
            return byte0 - (RLPItem.STRING_LONG_START - 1) + 1;
        else
            return byte0 - (RLPItem.LIST_LONG_START - 1) + 1;
    }

    // @return indicator whether encoded payload is a list. negate this function call for isData.
    isList(): bool {
        if (this.rlpLen() == 0) return false;
        return this.buffer[0] >= RLPItem.LIST_SHORT_START;
    }

    isEmpty() : bool {
        if (this.rlpLen() != 1) return false;
        const byte0 = this.buffer[0];
        return byte0 == (this.isList() ? RLPItem.LIST_SHORT_START : RLPItem.STRING_SHORT_START);
    }

    /*
  * @param item RLP encoded list in bytes
  */
    toList() : RLPItem[] {
        _require(this.isList());
        let items : RLPItem[] = [];
        let payload:Uint8Array = this.buffer.subarray(this.payloadOffset());
        while(payload.length > 0) {
            const itemLength = RLPItem.itemLength(payload);
            items.push(new RLPItem(payload.subarray(0, itemLength)));
            payload = payload.subarray(itemLength);
        }
        return items;
    }
    toRlpBytes() : Uint8Array {
        return this.buffer;
    }
    toBoolean() : bool {
        _require(this.rlpLen() == 1);
        return this.buffer[0] > 0;
    }

    toBytes() : Uint8Array {
        _require(this.rlpLen() > 0);
        const offset = this.payloadOffset();
        const len = this.rlpLen() - offset; // data length
        return this.buffer.subarray(offset, offset + len);
    }

    toUint() : u256 {
        _require(this.rlpLen() > 0 && this.rlpLen() <= 33);
        const byte32 = new Uint8Array(32);
        const bytes = this.toBytes();
        byte32.set(bytes, byte32.length - bytes.length);
        return u256.fromUint8ArrayBE(byte32);
    }

    toUintStrict() : u256 {
        _require(this.rlpLen() == 33);
        return this.toUint();
    }

    toAddress() : u256 {
        // 1 byte for the length prefix
        _require(this.rlpLen() == 21);
        return this.toUint();
    }
    toString() : string {
        return this.toBytes().toString()
    }
}

}
