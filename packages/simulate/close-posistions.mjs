import { DownloadState, SimulateCosmWasmClient } from '@oraichain/cw-simulate';
import { Cw20BaseClient } from '@oraichain/common-contracts-sdk';
import { MarginedEngineClient, MarginedVammClient } from '@oraichain/oraimargin-contracts-sdk';
import { contracts } from './config.mjs';

const SENDER = 'orai1fs25usz65tsryf0f8d5cpfmqgr0xwup4kjqpa0';
const BOT_ADDRESS = 'orai15vc7z4zyyam999zp6rwealm06lvuy9ykumwlpl';

const downloadState = new DownloadState('https://lcd.orai.io', 'data');
// downloadState.saveState(contracts.engineAddr),
// downloadState.saveState(contracts.oraiusdcVamm);
// downloadState.saveState(contracts.insuranceFundAddr);
// downloadState.saveState(contracts.usdcAddr);
// downloadState.saveState(contracts.feePoolAddr);

const client = new SimulateCosmWasmClient({
  chainId: 'Oraichain',
  bech32Prefix: 'orai'
});

for (const [label, contractAddress] of Object.entries(contracts)) {
  await downloadState.loadState(client, SENDER, contractAddress, label);
}

const engineContract = new MarginedEngineClient(client, BOT_ADDRESS, contracts.engineAddr);
const oraiVammContract = new MarginedVammClient(client, BOT_ADDRESS, contracts.oraiusdcVamm);

const usdcContract = new Cw20BaseClient(client, BOT_ADDRESS, contracts.usdcAddr);

let allPositionsOfBot = [];
let startAfter = undefined;
while (true) {
  let posistions = await engineContract.positions({
    filter: {
      trader: BOT_ADDRESS
    },
    startAfter,
    vamm: contracts.oraiusdcVamm
  });
  if (posistions.length == 0) break;

  allPositionsOfBot.push(...posistions);
  startAfter = posistions.pop().position_id;
}

let sportPrice = await oraiVammContract.spotPrice();
console.log('Sport price before close:', sportPrice);

let totalPNL = 0;
for (let [index, position] of Object.entries(allPositionsOfBot)) {
  let sportPrice = await oraiVammContract.spotPrice();
  let botBalance = await usdcContract.balance({ address: BOT_ADDRESS });
  console.log('Position size:', position.size);
  console.log(`${index} Sport price before close position ${position.position_id} : ${Number(sportPrice) / 1000000}, bot balance: ${Number(botBalance.balance) / 1000000}`);

  let pnl = (
    await engineContract.unrealizedPnl({
      calcOption: 'spot_price',
      positionId: position.position_id,
      vamm: contracts.oraiusdcVamm
    })
  ).unrealized_pnl;

  totalPNL += Number(pnl);
  if (index > 161) {
    console.log({
      positionId: position.position_id,
      vamm: contracts.oraiusdcVamm,
      quoteAssetLimit: '0'
    });

    await engineContract.liquidate({
      positionId: position.position_id,
      vamm: contracts.oraiusdcVamm,
      quoteAssetLimit: '0'
    });
  } else {
    await engineContract.closePosition({
      positionId: position.position_id,
      vamm: contracts.oraiusdcVamm,
      quoteAssetLimit: '0'
    });
  }

  // let currBotBalance = await usdcContract.balance({ address: BOT_ADDRESS });

  sportPrice = await oraiVammContract.spotPrice();
  let insuranceFundBalance = await usdcContract.balance({
    address: contracts.insuranceFundAddr
  });
  console.log(`${index} Sport price after close position ${position.position_id} : ${Number(sportPrice) / 1000000}`);
  console.log(`total PNL: ${Number(totalPNL) / 1000000}`);
  console.log('Insurance balance:', insuranceFundBalance);
}

// sportPrice = await oraiVammContract.spotPrice();
// console.log("Sport price after close:", sportPrice);
