import path from 'path';
import { DownloadState, SimulateCosmWasmClient, Ok } from '@oraichain/cw-simulate';
import { MarginedEngineClient, MarginedPricefeedClient } from '@oraichain/oraimargin-contracts-sdk';

const sender = 'orai1fs25usz65tsryf0f8d5cpfmqgr0xwup4kjqpa0';
const contracts = {
  engineAddr: 'orai1wrkchuss9wtph4mxrzqksfrulj7hsl89z0048hg8l7hcglse5rxqea2qnr',
  insuranceFundAddr: 'orai1l2z27tt0aq2vd2jr0g7vhy8975t6u3sly8pqay9ek3dctgpmkyrqju3dek',
  feePoolAddr: 'orai10q37uaq728y93u03dw6jzcxqqc36cu4q08k0c4wmhj4egqch69zstja6xu',
  pricefeedAddr: 'orai1s57duq6h0r0q6spfdhujnn695a3e9ka59zvv0yrvx7d80gvaf4hsfkezyr',
  injusdcVamm: 'orai1z36626k3s5k6nl0usn8543v67edn0rpgxnpr58xvr0luvdxu55cs96dv73',
  usdcAddr: 'orai15un8msx3n5zf9ahlxmfeqd2kwa5wm0nrpxer304m9nd5q6qq0g6sku5pdd'
};

const downloadState = new DownloadState('https://lcd.orai.io', path.resolve(__dirname, 'data'));

// downloadState.saveState(contracts.usdcAddr);

const client = new SimulateCosmWasmClient({
  chainId: 'Oraichain',
  bech32Prefix: 'orai'
});

for (const [label, contractAddress] of Object.entries(contracts)) {
  await downloadState.loadState(client, sender, contractAddress, label);
}

const engineContract = new MarginedEngineClient(client, sender, contracts.engineAddr);
const priceFeedContract = new MarginedPricefeedClient(client, 'orai1ek2243955krr3enky8jq8y8vhh3p63y5wjzs4j', contracts.pricefeedAddr);

const printPnL = async () => {
  let startAfter;
  let ret = [];
  while (true) {
    const positions = await engineContract.positions({ filter: 'none', vamm: contracts.injusdcVamm, startAfter });
    if (!positions.length) break;
    startAfter = positions[positions.length - 1].position_id;
    for (const position of positions) {
      // const pos = await engineContract.positionWithFundingPayment({ positionId: position.position_id, vamm: contracts.injusdcVamm });
      const pnl = await engineContract.unrealizedPnl({ positionId: position.position_id, calcOption: 'oracle', vamm: contracts.injusdcVamm });
      // @ts-ignore
      ret.push(pnl);
    }
  }
  console.table(ret);
};

console.log(await priceFeedContract.getPrice({ key: 'INJ' }));
await printPnL();
const currentBlockTime = (client.app.time / 1e9) >> 0;
await priceFeedContract.appendPrice({ key: 'INJ', price: '10000000', timestamp: currentBlockTime });
// pass 1 hour with 3_600 seconds
client.app.store.tx((setter) => Ok(setter('time')(client.app.time + 3_600 * 2 * 1e9)));
await engineContract.payFunding({ vamm: contracts.injusdcVamm });
console.log(await priceFeedContract.getPrice({ key: 'INJ' }));
await printPnL();
