
import { u256 } from "near-sdk-as";
import { math } from "near-sdk-as";
import { RlpReader } from "./RlpReader";
import {  _require, SolAbi } from './Solidity';

class MutiReturn {
    isLeaf : bool
    skipNibbles:Uint8Array
}

export class ProvethVerifier {

    isEmptyBytesequence(item : RlpReader.RLPItem ) : bool {
        return item.isEmpty();
    }

    decodeNibbles(compact : Uint8Array, skipNibbles : u32, append16 : u32) : Uint8Array {
        _require(compact.length > 0);

        let length:u32 = compact.length * 2;
        _require(skipNibbles <= length);
        length -= skipNibbles;

        const nibbles = new Uint8Array(length+append16);
        if(append16 == 1)
            nibbles[nibbles.length-1] = 0x10;
        let nibblesLength = 0;

        for (let i = skipNibbles; i < skipNibbles + length; i += 1) {
            if (i % 2 == 0) {
                nibbles[nibblesLength] = (compact[i/2] >> 4) & 0xF;
            } else {
                nibbles[nibblesLength] = (compact[i/2] >> 0) & 0xF;
            }
            nibblesLength += 1;
        }

        assert(nibblesLength + append16 == nibbles.length);
        return nibbles;
    }

    merklePatriciaCompactDecode(compact : Uint8Array) : MutiReturn {
        _require(compact.length > 0);
        
        const first_nibble = compact[0] >> 4 & 0xF;
        let skipNibbles = 0;
        let isLeaf = false;
        if (first_nibble == 0) {
            skipNibbles = 2;
            isLeaf = false;
        } else if (first_nibble == 1) {
            skipNibbles = 1;
            isLeaf = false;
        } else if (first_nibble == 2) {
            skipNibbles = 2;
            isLeaf = true;
        } else if (first_nibble == 3) {
            skipNibbles = 1;
            isLeaf = true;
        } else {
            // Not supposed to happen!
            _require(false);
        }
        return {isLeaf, skipNibbles:this.decodeNibbles(compact, skipNibbles, isLeaf?1:0)};
    }

    sharedPrefixLength(xsOffset:u32, xs:Uint8Array, ys:Uint8Array) : u32 {
        let i = 0;
        for (i = 0; i + xsOffset < xs.length && i < ys.length; i++) {
            if (xs[i + xsOffset] != ys[i]) {
                return i;
            }
        }
        return i;
    }

    /// @dev Computes the hash of the Merkle-Patricia-Trie hash of the input.
    ///      Merkle-Patricia-Tries use a weird "hash function" that outputs
    ///      *variable-length* hashes: If the input is shorter than 32 bytes,
    ///      the MPT hash is the input. Otherwise, the MPT hash is the
    ///      Keccak-256 hash of the input.
    ///      The easiest way to compare variable-length byte sequences is
    ///      to compare their Keccak-256 hashes.
    /// @param input The byte sequence to be hashed.
    /// @return Keccak-256(MPT-hash(input))
    mptHashHash(input : Uint8Array) : u256 {
        let hashArray : Uint8Array = math.keccak256(input);
        if (input.length >= 32)
            hashArray = math.keccak256(hashArray);
        return u256.fromUint8ArrayBE(hashArray);
    }

    keccak256(input : Uint8Array) : u256 {
        return u256.fromUint8ArrayBE(math.keccak256(input));
    }

    MPTProof(rootHash : u256, mptkey : Uint8Array, proof : Uint8Array) : Uint8Array {
        const item = new RlpReader.RLPItem(proof);
        const stacks = item.toList();
        return this.validateMPTProof(rootHash, mptkey, stacks);
    }

    /// @dev Validates a Merkle-Patricia-Trie proof.
    ///      If the proof proves the inclusion of some key-value pair in the
    ///      trie, the value is returned. Otherwise, i.e. if the proof proves
    ///      the exclusion of a key from the trie, an empty byte array is
    ///      returned.
    /// @param rootHash is the Keccak-256 hash of the root node of the MPT.
    /// @param mptKey is the key (consisting of nibbles) of the node whose
    ///        inclusion/exclusion we are proving.
    /// @param stack is the stack of MPT nodes (starting with the root) that
    ///        need to be traversed during verification.
    /// @return value whose inclusion is proved or an empty byte array for
    ///         a proof of exclusion
    validateMPTProof(
        rootHash : u256,
        mptKey : Uint8Array,
        stack : RlpReader.RLPItem[]
    ) : Uint8Array {
        mptKey = this.decodeNibbles(mptKey, 0, 1);
        let mptKeyOffset = 0;

        let nodeHashHash : u256 = u256.Zero;
        let rlpNode : Uint8Array;
        let node : RlpReader.RLPItem[];

        let rlpValue : RlpReader.RLPItem;

        if (stack.length == 0) {
            // Root hash of empty Merkle-Patricia-Trie
            const emptyHash = u256.fromBytesBE([86,232,31,23,27,204,85,166,255,131,69,230,146,192,248,110,91,72,224,27,153,108,173,192,1,98,47,181,227,99,180,33]);
            _require(rootHash == emptyHash);
            return new Uint8Array(0);
        }

        // Traverse stack of nodes starting at root.
        for (let i = 0; i < stack.length; i++) {

            // We use the fact that an rlp encoded list consists of some
            // encoding of its length plus the concatenation of its
            // *rlp-encoded* items.
            rlpNode = stack[i].toRlpBytes();
            // The root node is hashed with Keccak-256 ...
            if (i == 0 && rootHash != this.keccak256(rlpNode)) {
                _require(false);
            }
            // ... whereas all other nodes are hashed with the MPT
            // hash function.
            if (i != 0 && nodeHashHash != this.mptHashHash(rlpNode)) {
                _require(false);
            }
            // We verified that stack[i] has the correct hash, so we
            // may safely decode it.
            node = stack[i].toList();

            if (node.length == 2) {
                // Extension or Leaf node

                let isLeaf:bool = false;
                let nodeKey : Uint8Array;
                const r = this.merklePatriciaCompactDecode(node[0].toBytes());
                isLeaf = r.isLeaf;
                nodeKey = r.skipNibbles;

                const prefixLength = this.sharedPrefixLength(mptKeyOffset, mptKey, nodeKey);
                mptKeyOffset += prefixLength;

                if (prefixLength < <u32>nodeKey.length) {
                    // Proof claims divergent extension or leaf. (Only
                    // relevant for proofs of exclusion.)
                    // An Extension/Leaf node is divergent iff it "skips" over
                    // the point at which a Branch node should have been had the
                    // excluded key been included in the trie.
                    // Example: Imagine a proof of exclusion for path [1, 4],
                    // where the current node is a Leaf node with
                    // path [1, 3, 3, 7]. For [1, 4] to be included, there
                    // should have been a Branch node at [1] with a child
                    // at 3 and a child at 4.

                    // Sanity check
                    if (i < stack.length - 1) {
                        // divergent node must come last in proof
                        _require(false);
                    }

                    return new Uint8Array(0);
                }

                if (isLeaf) {
                    // Sanity check
                    if (i < stack.length - 1) {
                        // leaf node must come last in proof
                        _require(false);
                    }

                    if (mptKeyOffset < mptKey.length) {
                        return new Uint8Array(0);
                    }

                    rlpValue = node[1];
                    return rlpValue.toBytes();
                } else { // extension
                    // Sanity check
                    if (i == stack.length - 1) {
                        // shouldn't be at last level
                        _require(false);
                    }

                    if (!node[1].isList()) {
                        // rlp(child) was at least 32 bytes. node[1] contains
                        // Keccak256(rlp(child)).
                        nodeHashHash = this.keccak256(node[1].toBytes());
                    } else {
                        // rlp(child) was at less than 32 bytes. node[1] contains
                        // rlp(child).
                        nodeHashHash = this.keccak256(node[1].toRlpBytes());
                    }
                }
            } else if (node.length == 17) {
                // Branch node

                if (mptKeyOffset != mptKey.length) {
                    // we haven't consumed the entire path, so we need to look at a child
                    const nibble = mptKey[mptKeyOffset];
                    mptKeyOffset += 1;
                    if (nibble >= 16) {
                        // each element of the path has to be a nibble
                        _require(false);
                    }

                    if (this.isEmptyBytesequence(node[nibble])) {
                        // Sanity
                        if (i != stack.length - 1) {
                            // leaf node should be at last level
                            _require(false);
                        }

                        return new Uint8Array(0);
                    } else if (!node[nibble].isList()) {
                        nodeHashHash = this.keccak256(node[nibble].toBytes());
                    } else {
                        nodeHashHash = this.keccak256(node[nibble].toRlpBytes());
                    }
                } else {
                    // we have consumed the entire mptKey, so we need to look at what's contained in this node.

                    // Sanity
                    if (i != stack.length - 1) {
                        // should be at last level
                        _require(false);
                    }

                    return node[16].toBytes();
                }
            }
        }
        return new Uint8Array(0);
    }
}
