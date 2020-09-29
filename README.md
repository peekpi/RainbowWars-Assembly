# RainbowWars AssemblyScript Contract

## Description
RainbowWars is a cross-chain game. Here is the [description][describe] and [demo][demo].

This is the near contract for RainbowWars.
The RainbowWars project consists of three parts:
- [ethereum solidity contract][ethcontract]
- [near assembly contract][nearcontract]
- [vue frontend][frontend]

> This repo was ported from [near-Counter][counter] demo. Only use the assembly contract part, please ignore the front-end part.

## Setup
Install dependencies:

```
yarn
```

Make sure you have `near-cli` by running:

```
near --version
```

If you need to install `near-cli`:

```
npm install near-cli -g
```

## Modify the contract code
Modify the `assembly/main.ts`, changing the `otherSideBridge` to your ethereum Contract Address:
```
...
const otherSideBridge:u256 = str2u256('ETH CONTRACT ADDRESS');
...
```

## Compilation
```
yarn build
```

## Deployment
1. login your near account
···
near login
···
2. deploy the contract
```
near deploy
```

[counter]: https://github.com/near-examples/counter
[demo]: https://peekpi.github.io/RainbowWars/dist
[ethcontract]: https://github.com/peekpi/RainbowWars-Solidity
[nearcontract]: https://github.com/peekpi/RainbowWars-Assembly
[frontend]: https://github.com/peekpi/RainbowWars-Vue
[describe]: https://github.com/peekpi/RainbowWars