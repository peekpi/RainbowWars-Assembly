import { context, env, logging } from "near-sdk-as";
import { u128, u256} from "near-sdk-as";
import { StorageValue, _require, msg, block, SolAbi, Address , StorageMap, StorageVector } from './Solidity';
import { RlpReader } from "./RlpReader";
import { ProvethVerifier } from "./MPT";
import { util } from "near-sdk-as";


function ReturnSuccessValue(data:Uint8Array) : void {
  env.value_return(data.byteLength, data.dataStart);
  //env.log_utf8(data.byteLength, data.dataStart);
}

const difficult = new StorageValue<u256>(u256.Max);
const bulletPrice = new StorageValue<u256>(u256.Zero);
const attackIndex = new StorageValue<u256>(u256.Zero);
const otherDifficult = new StorageValue<u256>(u256.Max);
const attackSeedHistory = new StorageVector<u256>("___attackSeedHistory", u256.Zero); // AttackInfo[]
const attackAddressHistory = new StorageVector<u256>("___attackAddressHistory", u256.Zero); // AttackInfo[]
const spentReceipt = new StorageMap<u256,bool>("__spentReceipt", false);

// ERC20 tokens code
const balances = new StorageMap<u256, u256>("__bals:", u256.Zero);
const approves = new StorageMap<u256, u256>("_approves:", u256.Zero);

const TOTAL_SUPPLY = new StorageValue<u256>(u256.Zero);;


function _mint(to:u256, amount:u256):void {
  TOTAL_SUPPLY.value += amount;
  logging.log("mint:" + amount.toString());
  const toAddress = Address.fromU256(to);
  const toAccount =  getBalance(toAddress);
  const total = toAccount + amount;
  setBalance(toAddress, total);
}

function _burn(amount:u256):void{
  TOTAL_SUPPLY.value = u256sub(TOTAL_SUPPLY.value, amount);
  //TOTAL_SUPPLY.value -= amount;
  const account = getBalance(msg.sender);
  setBalance(msg.sender, u256sub(account, amount));
}

export function burn(amount:u64):void {
  const account = getBalance(msg.sender);
  const total = TOTAL_SUPPLY.value;
  _burn(u256.fromU64(amount));
  const contractAddress = new Address(context.contractName);
  const rewards:u128 = contractAddress.balance * u128.from(amount) / total.toU128();
  msg.sender.transfer(rewards.toU256());
}

export function totalSupply(): string {
  return TOTAL_SUPPLY.value.toString();
}

export function balanceOf(tokenOwner: string): u64 {
  const address = new Address(tokenOwner);
  return getBalance(address).toU64();
}

export function allowance(tokenOwner: string, spender: string): u64 {
  const ownerAddress = new Address(tokenOwner);
  const spenderAddress = new Address(spender);
  return getAllowance(ownerAddress, spenderAddress).toU64();
}

export function transfer(to: string, tokens64: u64): boolean {
  const tokens = u256.fromU64(tokens64);
  const toAddress = new Address(to);
  logging.log("transfer: " + msg.sender.account + " to: " + to + " tokens: " + tokens64.toString());
  _transfer(msg.sender, toAddress, tokens);
  return true;
}

export function approve(spender: string, tokens: u64): boolean {
  const spenderAddress = new Address(spender);
  logging.log("approve: " + spender + " tokens: " + tokens.toString());
  setAllowance(msg.sender, spenderAddress, u256.fromU64(tokens));
  return true;
}

export function transferFrom(from: string, to: string, tokens64: u64): boolean {
  logging.log("transferFrom: " + from + " to: " + to + " tokens: " + tokens64.toString() + " by: " + msg.sender.account);
  const tokens = u256.fromU64(tokens64);
  const fromAddress = new Address(from);
  const toAddress = new Address(to);
  const fromAmount = getBalance(fromAddress);
  assert(fromAmount >= tokens, "not enough tokens on account");
  const approvedAmount = getAllowance(fromAddress, msg.sender);
  assert(tokens <= approvedAmount, "not enough tokens approved to transfer");
  const toAccount = getBalance(toAddress);
  assert(getBalance(toAddress) <= toAccount + tokens,"overflow at the receiver side");
  setBalance(fromAddress, u256sub(fromAmount, tokens));
  setBalance(toAddress, getBalance(toAddress) + tokens); // must read again: if from == to
  setAllowance(fromAddress, msg.sender, u256sub(approvedAmount, tokens));
  return true;
}

function _transfer(from: Address, to:Address, amount:u256):void {
  const fromAmount = getBalance(from);
  assert(fromAmount >= amount, "not enough tokens on account");
  assert(getBalance(to) <= getBalance(to) + amount,"overflow at the receiver side");
  setBalance(msg.sender, u256sub(fromAmount, amount));
  setBalance(to, getBalance(to) + amount); // must read again: if from == to
}

function getBalance(owner: Address): u256 {
  return balances.get(owner);
}

function setBalance(owner: Address, balance:u256):void {
  balances.set(<u256>owner, balance);
}

function getAllowance(tokenOwner: Address, spender: Address): u256 {
  const key = tokenOwner.account + ":" + spender.account;
  const address = new Address(key);
  return approves.get(address);
}
function setAllowance(tokenOwner: Address, spender: Address, amount:u256): void {
  const key = tokenOwner.account + ":" + spender.account;
  const address = new Address(key);
  approves.set(address, amount);
}

// bridage code

export function init():void{
  logging.log(difficult.value.toUint8Array(true))
  TOTAL_SUPPLY.value = u256.Zero;
  difficult.value = u256.Max;
  bulletPrice.value = u256.Zero;
  attackIndex.value = u256.Zero;
  otherDifficult.value = u256.Max;
  logging.log(difficult.value.toUint8Array(true))
}

function str2hex(str:string):Uint8Array {
  str = str.toUpperCase();
  if(str.startsWith('0X'))
    str = str.slice(2);
  const ch0:u8 = 0x30;   // '0'
  const chA:u8 = 0x41;  // 'A'
  const ret = new Uint8Array(str.length/2);
  for(let i = 0; i < str.length; i+=2){
    const ch:u8 = <u8>str.charCodeAt(i);
    let n:u8;
    if(ch >= chA) n = ch - (chA - <u8>0xa);
    else n = ch-ch0;
    const ch1 = <u8>str.charCodeAt(i+1);
    let n1:u8;
    if(ch1 >= chA) n1 = ch1 - (chA - <u8>0xa);
    else n1 = ch1-ch0;
    ret[i/2] = (n<<4)|n1;
  }
  return ret;
}

function str2u256(str:string):u256 {
  const hexStr = str2hex(str);
  const bytes32 = new Uint8Array(32);
  bytes32.set(hexStr, bytes32.length - hexStr.length);
  return u256.fromUint8ArrayBE(bytes32);
}

//const attackEvent = util.stringToBytes()
// 0x0xBC2D976E4A9331961e4478ae2b3d0BaD0C47393e
const prover = new ProvethVerifier();
const otherSideBridge:u256 = str2u256('0x2796cAaDC53f5d907332a2573F20DF23eA57C687');
const attackSig = prover.keccak256(util.stringToBytes('etherAttack(address,uint256,uint256,uint256,bytes32)'));

//const attackSig = u256.Zero;
function receiptVerify(rlpdata : Uint8Array) : u32 {
  let ret = 0;
  const stacks = new RlpReader.RLPItem(rlpdata);
  const receipt = stacks.toList();
  const PostStateOrStatus = receipt[0].toUint();
  _require(PostStateOrStatus == u256.One, "revert receipt");
  //uint CumulativeGasUsed = receipt[1].toUint();
  //bytes memory Bloom = receipt[2].toBytes();
  
  const Logs = receipt[3].toList();
  for(let i = 0; i < Logs.length; i++) {
      const rlpLog = Logs[i].toList();
      const Address = rlpLog[0].toAddress();
      if(Address != otherSideBridge) continue;
      ret++;
      const Topics = rlpLog[1].toList(); // TODO: if is lock event
      const topics : u256[] = [];
      for(let j = 0; j < Topics.length; j++) {
          topics.push(Topics[j].toUint());
      }
      const Data = rlpLog[2].toBytes();
      if(topics[0] == attackSig) {
        const _difficult = u256.fromUint8ArrayBE(Data.subarray(0, 32));
        const _timestamp = u256.fromUint8ArrayBE(Data.subarray(32, 64));
        const beneficiary = u256.fromUint8ArrayBE(Data.subarray(64, 96));
        onAttackEvent(topics[1], topics[2], _difficult, _timestamp, beneficiary);
      }
  }
  return ret; 
}


function getBlockHash(blockNo: u256): u256 {
  //return keccak256(abi.encodePacked(difficult, otherDifficult, msg.sender, address(this), blockNo, attackIndex, attackseedHistory.length, bulletPrice));
  //return blockhash(blockNo);
  return blockNo;
}

function thisSideEvent(): void {
  difficult.value = u256sub(difficult.value, u256.One)
  //difficult.value -= u256.One;
}

// there are many bugs in u256……
function u256sub(a:u256, b:u256):u256{
  const loa:u128 = a.toU128();
  const hia:u128 = (a>>128).toU128();
  const lob:u128 = b.toU128();
  const hib:u128 = (b>>128).toU128();
  let hi:u128 = hia - hib;
  let lo:u128;
  if(loa > lob){
    lo = loa - lob;
  }else{
    lo = u128.Max - (lob - loa) + u128.One;
    hi -= u128.One;
  }
  return new u256(lo.lo, lo.hi, hi.lo, hi.hi)
}
function otherSideEvent(): void {
  difficult.value = u256sub(difficult.value, u256.fromU32(10));
  //difficult.value -= u256.fromU32(10);
}

export function attack(beneficiary:Uint8Array): void {
  deal();
  thisSideEvent();
  const bullet = msg.value < bulletPrice.value ? 0 : 1; //msg.value / bulletPrice.value;
  //_require(bullet > 0 && bullet < 10, "bullet need between (0,10)");
  const totalSpend = bulletPrice.value; // u256.fromU32(bullet) * bulletPrice.value;
  if (totalSpend < msg.value) msg.sender.transfer(u256sub(msg.value, totalSpend));
  const abi = new SolAbi().append(attackSig)
     .append(<u256>msg.sender)
     .append(u256.fromU32(bullet))
     .append(difficult.value)
     .append(block.timestamp)
     .append(u256.fromUint8ArrayBE(beneficiary));
  ReturnSuccessValue(abi.encode());
}

export function ExecProof(blockHash: Uint8Array, roothash:Uint8Array, mptkey:Uint8Array, proof:Uint8Array): void {
  deal();
  const receiptRootHashNum = u256.fromUint8ArrayBE(roothash);
  const blockHashNum = u256.fromUint8ArrayBE(blockHash);
  const mptKeyNum = prover.keccak256(mptkey);
  const abi = new SolAbi().append(blockHashNum)
                          .append(receiptRootHashNum)
                          .append(mptKeyNum);
  const spentKey = prover.keccak256(abi.encodePacked());
  _require(!spentReceipt.contains(spentKey), "double spending!");
  spentReceipt.set(spentKey, true);
  const rlpdata = prover.MPTProof(receiptRootHashNum, mptkey, proof);
  const events = receiptVerify(rlpdata);
  _require(events > 0, "no valid event");
}

function onAttackEvent(attacker: u256, bullet: u256, _difficult: u256, timestamp: u256, beneficiary: u256): void {
  otherSideEvent();
  _require(otherDifficult.value != _difficult, "difficult can't equeal");
  if (otherDifficult.value > _difficult) otherDifficult.value = _difficult;
  _require(timestamp < block.timestamp && block.timestamp < timestamp + u256.fromU32(24 * 3600), "attack must be within a day");

  const abi = new SolAbi().append(attacker).append(bullet).append(otherDifficult.value).append(timestamp)

  const attackSeed = prover.keccak256(abi.encode());
  const sotreSeed = attackSeed&(~u256.fromU32(u32.MAX_VALUE))|block.number;
  attackSeedHistory.push(sotreSeed);
  attackAddressHistory.push(beneficiary);
  logging.log("onAttackEvent:" + attackIndex.value.toU32().toString() + "/" + attackSeedHistory.length.toString());
}

export function deal(): void {
  const index = attackIndex.value.toU32();
  if(index >= <u32>attackSeedHistory.length) return;
  
  const attackSeed = attackSeedHistory[index];
  const beneficiary = attackAddressHistory[index];
  const attackBlockNo = attackSeed & u256.fromU32(u32.MAX_VALUE);
  if(attackBlockNo == block.number) return;
  const attackBlockHash = getBlockHash(attackBlockNo);
  const dealParentHash = getBlockHash(u256sub(block.number, u256.One));

  const defenSeed = prover.keccak256(new SolAbi().append(difficult.value).append(block.number).append(dealParentHash).encode()); // uint256(keccak256(abi.encodePacked(difficult, block.number, dealParentHash)));
  const finalAttackSeed = prover.keccak256(new SolAbi().append(attackSeed).append(attackBlockNo).append(attackBlockHash).append(defenSeed).encode());

  const attackValue = otherDifficult.value + finalAttackSeed;
  const defenValue = difficult.value + defenSeed;
  if (attackValue < defenValue) {
    _mint(beneficiary, u256.fromU32(10000000));
  }else{
    _mint(beneficiary, u256.fromU32(1000000));
  }
  if (difficult.value > finalAttackSeed) difficult.value = finalAttackSeed;
  attackIndex.value += u256.One;
  logging.log("deal end:" + attackIndex.value.toU32().toString() + "/" + attackSeedHistory.length.toString());
}
