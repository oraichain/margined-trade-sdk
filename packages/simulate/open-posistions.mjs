// @ts-nocheck
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import contractArtifacts from "@oraichain/oraimargin-contracts-build";
import { SimulateCosmWasmClient, DownloadState } from "@oraichain/cw-simulate";
import {
  MarginedEngineClient,
  MarginedPricefeedClient,
  MarginedVammClient,
} from "@oraichain/oraimargin-contracts-sdk";
import { Cw20BaseClient } from "@oraichain/common-contracts-sdk";
import { contracts } from "./config.mjs";

if (typeof __dirname === "undefined") {
  const __filename = fileURLToPath(import.meta.url);
  globalThis.__dirname = path.dirname(__filename);
}

const BOT_ADDRESS = "orai15vc7z4zyyam999zp6rwealm06lvuy9ykumwlpl";

const downloadState = new DownloadState("https://lcd.orai.io", "data");
// downloadState.saveState(contracts.engineAddr);
// downloadState.saveState(contracts.insuranceFundAddr);
// downloadState.saveState(contracts.feePoolAddr);
// downloadState.saveState(contracts.pricefeedAddr);
// downloadState.saveState(contracts.injusdcVamm);
// downloadState.saveState(contracts.oraiusdcVamm);

const senderAddress = "orai1fs25usz65tsryf0f8d5cpfmqgr0xwup4kjqpa0";
const client = new SimulateCosmWasmClient({
  chainId: "Oraichain",
  bech32Prefix: "orai",
  metering: true,
});

import { BufferCollection, SortedMap, compare } from "@oraichain/cw-simulate";

const loadState = async (address, label) => {
  const wasmPath = path.resolve(__dirname, "data");
  const wasmCode = fs.readFileSync(wasmMap[label] || `${wasmPath}/${address}`);
  const { codeId } = await client.upload(senderAddress, wasmCode, "auto");

  const buffer = fs.readFileSync(`${wasmPath}/${address}.state`);
  const state = SortedMap.rawPack(new BufferCollection(buffer), compare);
  await client.loadContract(
    address,
    {
      codeId,
      admin: senderAddress,
      label,
      creator: senderAddress,
      created: 1,
    },
    state
  );
};

const wasmMap = {
  // oraiusdcVamm: contractArtifacts.getContractDir("margined_vamm"),
  injusdcVamm: contractArtifacts.getContractDir("margined_vamm"),
};

await Promise.all(
  Object.entries(contracts).map(([label, contractAddress]) =>
    loadState(contractAddress, label)
  )
);
const admin = "orai1fs25usz65tsryf0f8d5cpfmqgr0xwup4kjqpa0";
const engineContract = new MarginedEngineClient(
  client,
  senderAddress,
  contracts.engineAddr
);
const priceFeedContract = new MarginedPricefeedClient(
  client,
  admin,
  contracts.pricefeedAddr
);
const oraiVammContract = new MarginedVammClient(
  client,
  admin,
  contracts.oraiusdcVamm
);
const injVammContract = new MarginedVammClient(
  client,
  admin,
  contracts.injusdcVamm
);
const usdcContract = new Cw20BaseClient(
  client,
  senderAddress,
  contracts.usdcAddr
);

console.log("vamm state", await injVammContract.state());
// console.log("index price", await injVammContract.twapPrice({ interval: 30 }));

// injVammContract.sender = "orai1ek2243955krr3enky8jq8y8vhh3p63y5wjzs4j";
// console.log(
//   await injVammContract.migrateLiquidity({
//     liquidityMultiplier: "16666666",
//     fluctuationLimitRatio: "100000",
//   })
// );

const printPnL = async () => {
  let startAfter;
  let ret = [];
  while (true) {
    const positions = await engineContract.positions({
      filter: "none",
      vamm: contracts.injusdcVamm,
      startAfter,
    });
    if (!positions.length) break;
    startAfter = positions[positions.length - 1].position_id;
    for (const position of positions) {
      // console.log(position);
      const pos = await engineContract.positionWithFundingPayment({
        positionId: position.position_id,
        vamm: contracts.injusdcVamm,
      });

      const pnl = await engineContract.unrealizedPnl({
        positionId: position.position_id,
        calcOption: "spot_price",
        vamm: contracts.injusdcVamm,
      });

      pnl.trader = pos.trader;
      pnl.position_id = pos.position_id;
      pnl.price_feed = position.entry_price;
      ret.push(pnl);
    }
  }
  console.table(ret);
};

console.log("index price", await injVammContract.spotPrice());
await printPnL();

const trader = "orai1fgk4uzrxetfxjy7s743p3ym2qqya6zwn0euakv";

usdcContract.sender = BOT_ADDRESS;
await usdcContract.increaseAllowance({
  amount: "300000000000",
  spender: contracts.engineAddr,
});

// // make long order
engineContract.sender = BOT_ADDRESS;
await engineContract.openPosition({
  vamm: injVammContract.contractAddress,
  side: "sell",
  marginAmount: "10000000000",
  leverage: "10000000",
  baseAssetLimit: "0",
  takeProfit: "10000000",
  stopLoss: "1000000000",
});

console.log("index price", await injVammContract.spotPrice());

// // client.app.time += 3600 * 1e9;

// // console.log("vamm state", await injVammContract.state());
// // console.log("index price", await injVammContract.twapPrice({ interval: 30 }));

// // console.log('oracle price', await vammContract.underlyingTwapPrice({ interval: 3600 }));
// // const currentBlockTime = (client.app.time / 1e9) >> 0;
// // await priceFeedContract.appendPrice({ key: 'INJ', price: '10000000', timestamp: currentBlockTime });
// // await engineContract.payFunding({ vamm: contracts.injusdcVamm });
// console.log("oracle price", await priceFeedContract.getPrice({ key: "INJ" }));
await printPnL();
