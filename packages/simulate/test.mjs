// @ts-nocheck
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import contractArtifacts from '@oraichain/oraimargin-contracts-build';
import { SimulateCosmWasmClient, DownloadState } from '@oraichain/cw-simulate';
import { MarginedEngineClient, MarginedPricefeedClient, MarginedVammClient } from '@oraichain/oraimargin-contracts-sdk';
import { Cw20BaseClient } from '@oraichain/common-contracts-sdk';

if (typeof __dirname === 'undefined') {
  const __filename = fileURLToPath(import.meta.url);
  globalThis.__dirname = path.dirname(__filename);
}

const contracts = {
  engineAddr: 'orai1wrkchuss9wtph4mxrzqksfrulj7hsl89z0048hg8l7hcglse5rxqea2qnr',
  insuranceFundAddr: 'orai1l2z27tt0aq2vd2jr0g7vhy8975t6u3sly8pqay9ek3dctgpmkyrqju3dek',
  feePoolAddr: 'orai10q37uaq728y93u03dw6jzcxqqc36cu4q08k0c4wmhj4egqch69zstja6xu',
  pricefeedAddr: 'orai1s57duq6h0r0q6spfdhujnn695a3e9ka59zvv0yrvx7d80gvaf4hsfkezyr',
  injusdcVamm: 'orai1z36626k3s5k6nl0usn8543v67edn0rpgxnpr58xvr0luvdxu55cs96dv73',
  usdcAddr: 'orai15un8msx3n5zf9ahlxmfeqd2kwa5wm0nrpxer304m9nd5q6qq0g6sku5pdd'
};

const downloadState = new DownloadState('https://lcd.orai.io', 'data');
// downloadState.saveState(contracts.engineAddr);
// downloadState.saveState(contracts.insuranceFundAddr);
// downloadState.saveState(contracts.feePoolAddr);
// downloadState.saveState(contracts.pricefeedAddr);
// downloadState.saveState(contracts.injusdcVamm);

const senderAddress = 'orai1fs25usz65tsryf0f8d5cpfmqgr0xwup4kjqpa0';
const client = new SimulateCosmWasmClient({
  chainId: 'Oraichain',
  bech32Prefix: 'orai',
  metering: true
});

import { BufferCollection, SortedMap, compare } from '@oraichain/cw-simulate';

const loadState = async (address, label) => {
  const wasmPath = path.resolve(__dirname, 'data');
  const wasmCode = fs.readFileSync(wasmMap[label] || `${wasmPath}/${address}`);
  const { codeId } = await client.upload(senderAddress, wasmCode, 'auto');

  const buffer = fs.readFileSync(`${wasmPath}/${address}.state`);
  const state = SortedMap.rawPack(new BufferCollection(buffer), compare);
  await client.loadContract(
    address,
    {
      codeId,
      admin: senderAddress,
      label,
      creator: senderAddress,
      created: 1
    },
    state
  );
};

const wasmMap = {
  // injusdcVamm: contractArtifacts.getContractDir('margined_vamm')
};

await Promise.all(Object.entries(contracts).map(([label, contractAddress]) => loadState(contractAddress, label)));
const admin = 'orai1ek2243955krr3enky8jq8y8vhh3p63y5wjzs4j';
const engineContract = new MarginedEngineClient(client, senderAddress, contracts.engineAddr);
const priceFeedContract = new MarginedPricefeedClient(client, admin, contracts.pricefeedAddr);
const vammContract = new MarginedVammClient(client, admin, contracts.injusdcVamm);
const usdcContract = new Cw20BaseClient(client, senderAddress, contracts.usdcAddr);

const printPnL = async () => {
  let startAfter;
  let ret = [];
  while (true) {
    const positions = await engineContract.positions({ filter: 'none', vamm: contracts.injusdcVamm, startAfter });
    if (!positions.length) break;
    startAfter = positions[positions.length - 1].position_id;
    for (const position of positions) {
      const pos = await engineContract.positionWithFundingPayment({ positionId: position.position_id, vamm: contracts.injusdcVamm });
      const pnl = await engineContract.unrealizedPnl({ positionId: position.position_id, calcOption: 'oracle', vamm: contracts.injusdcVamm });
      pnl.trader = pos.trader;
      pnl.position_id = pos.position_id;
      ret.push(pnl);
    }
  }
  console.table(ret);
};

console.log('vamm state', await vammContract.state());
console.log('index price', await vammContract.twapPrice({ interval: 30 }));

// console.log(await vammContract.migrateLiquidity({ liquidityMultiplier: '500000' }));

const trader = 'orai1fgk4uzrxetfxjy7s743p3ym2qqya6zwn0euakv';

usdcContract.sender = trader;
await usdcContract.increaseAllowance({ amount: '1000000000', spender: contracts.engineAddr });

// make short order
engineContract.sender = trader;
await engineContract.openPosition({
  vamm: vammContract.contractAddress,
  side: 'sell',
  marginAmount: '1000000000',
  leverage: '3000000',
  baseAssetLimit: '0',
  takeProfit: '4400000',
  stopLoss: '18000000'
});

client.app.time += 3600 * 1e9;

console.log('vamm state', await vammContract.state());
console.log('index price', await vammContract.twapPrice({ interval: 30 }));

// console.log('oracle price', await vammContract.underlyingTwapPrice({ interval: 3600 }));
// const currentBlockTime = (client.app.time / 1e9) >> 0;
// await priceFeedContract.appendPrice({ key: 'INJ', price: '10000000', timestamp: currentBlockTime });
// await engineContract.payFunding({ vamm: contracts.injusdcVamm });
// console.log('oracle price', await priceFeedContract.getPrice({ key: 'INJ' }));
await printPnL();

// console.log(await engineContract.liquidate({ positionId: 6534, quoteAssetLimit: '0', vamm: contracts.injusdcVamm }));
