# Rainbow-bridge-wars NearSide in AssemblyScript

## Description
This is the near contract for RawinbowWars. The RainbowWars project consists of three parts:
- ethereum contract
- near contract
- frontend

> This repo is port from [near-Counter][counter] demo. Only use the assembly contract part, please ignore the front end part.

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