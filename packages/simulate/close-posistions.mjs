import { DownloadState, SimulateCosmWasmClient } from "@oraichain/cw-simulate";
import { Cw20BaseClient } from "@oraichain/common-contracts-sdk";
import {
  MarginedEngineClient,
  MarginedVammClient,
} from "@oraichain/oraimargin-contracts-sdk";

const SENDER = "orai1fs25usz65tsryf0f8d5cpfmqgr0xwup4kjqpa0";
const contracts = {
  engineAddr: "orai1wrkchuss9wtph4mxrzqksfrulj7hsl89z0048hg8l7hcglse5rxqea2qnr",
  insuranceFundAddr:
    "orai1l2z27tt0aq2vd2jr0g7vhy8975t6u3sly8pqay9ek3dctgpmkyrqju3dek",
  feePoolAddr:
    "orai10q37uaq728y93u03dw6jzcxqqc36cu4q08k0c4wmhj4egqch69zstja6xu",
  injusdcVamm:
    "orai1z36626k3s5k6nl0usn8543v67edn0rpgxnpr58xvr0luvdxu55cs96dv73",
  oraiusdcVamm:
    "orai1hgc4tmvuj6zuagyjpjjdrgwzj6ncgclm0n6rn4vwjg3wdxxyq0fs9k3ps9",
  usdc: "orai15un8msx3n5zf9ahlxmfeqd2kwa5wm0nrpxer304m9nd5q6qq0g6sku5pdd",
};

const BOT_ADDRESS = "orai15vc7z4zyyam999zp6rwealm06lvuy9ykumwlpl";

const downloadState = new DownloadState("https://lcd.orai.io", "data");
// downloadState.saveState(contracts.engineAddr),
// downloadState.saveState(contracts.oraiusdcVamm);
// downloadState.saveState(contracts.insuranceFundAddr);
// downloadState.saveState(contracts.usdc);
// downloadState.saveState(contracts.feePoolAddr);

const client = new SimulateCosmWasmClient({
  chainId: "Oraichain",
  bech32Prefix: "orai",
});

for (const [label, contractAddress] of Object.entries(contracts)) {
  await downloadState.loadState(client, SENDER, contractAddress, label);
}

const engineContract = new MarginedEngineClient(
  client,
  BOT_ADDRESS,
  contracts.engineAddr
);
const oraiVammContract = new MarginedVammClient(
  client,
  BOT_ADDRESS,
  contracts.oraiusdcVamm
);

const usdcContract = new Cw20BaseClient(client, BOT_ADDRESS, contracts.usdc);

let allPositionsOfBot = [];
let startAfter = undefined;
while (true) {
  let posistions = await engineContract.positions({
    filter: {
      trader: BOT_ADDRESS,
    },
    startAfter,
    vamm: contracts.oraiusdcVamm,
  });
  if (posistions.length == 0) break;

  allPositionsOfBot.push(...posistions);
  startAfter = posistions.pop().position_id;
}

let sportPrice = await oraiVammContract.spotPrice();
console.log("Sport price before close:", sportPrice);
await engineContract.liquidate({
  positionId: 5995,
  vamm: contracts.oraiusdcVamm,
  quoteAssetLimit: "0",
});

// let totalPNL = 0;
// for (let [index, position] of Object.entries(allPositionsOfBot)) {
//   let sportPrice = await oraiVammContract.spotPrice();
//   let botBalance = await usdcContract.balance({ address: BOT_ADDRESS });
//   console.log("Position size:", position.size);
//   console.log(
//     `${index} Sport price before close position ${position.position_id} : ${
//       Number(sportPrice) / 1000000
//     }, bot balance: ${Number(botBalance.balance) / 1000000}`
//   );

//   let pnl = (
//     await engineContract.unrealizedPnl({
//       calcOption: "spot_price",
//       positionId: position.position_id,
//       vamm: contracts.oraiusdcVamm,
//     })
//   ).unrealized_pnl;

//   totalPNL += Number(pnl);
//   if (index > 161) {
//     console.log({
//       positionId: position.position_id,
//       vamm: contracts.oraiusdcVamm,
//       quoteAssetLimit: "0",
//     });

//     await engineContract.liquidate({
//       positionId: position.position_id,
//       vamm: contracts.oraiusdcVamm,
//       quoteAssetLimit: "0",
//     });
//   } else {
//     await engineContract.closePosition({
//       positionId: position.position_id,
//       vamm: contracts.oraiusdcVamm,
//       quoteAssetLimit: "0",
//     });
//   }

//   // let currBotBalance = await usdcContract.balance({ address: BOT_ADDRESS });

//   sportPrice = await oraiVammContract.spotPrice();
//   let insuranceFundBalance = await usdcContract.balance({
//     address: contracts.insuranceFundAddr,
//   });
//   console.log(
//     `${index} Sport price after close position ${position.position_id} : ${
//       Number(sportPrice) / 1000000
//     }`
//   );
//   console.log(`total PNL: ${Number(totalPNL) / 1000000}`);
//   console.log("Insurance balance:", insuranceFundBalance);
// }

// sportPrice = await oraiVammContract.spotPrice();
// console.log("Sport price after close:", sportPrice);
