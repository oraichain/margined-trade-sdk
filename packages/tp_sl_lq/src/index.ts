import { UserWallet, bigAbs } from "@oraichain/oraimargin-common";
import { ExecuteInstruction } from "@cosmjs/cosmwasm-stargate";

import {
  MarginedEngineTypes,
  Addr,
  MarginedEngineQueryClient,
  MarginedVammQueryClient,
  MarginedInsuranceFundQueryClient,
} from "@oraichain/oraimargin-contracts-sdk";

export class TpSlHandler {}

const queryAllTicks = async (
  vamm: Addr,
  client: MarginedEngineQueryClient,
  side: MarginedEngineTypes.Side,
  limit?: number
): Promise<MarginedEngineTypes.TickResponse[]> => {
  let totalTicks: MarginedEngineTypes.TickResponse[] = [];
  let tickQuery = {
    limit: limit ?? 100,
    orderBy: side === "buy" ? 2 : 1,
    side,
    vamm,
  };
  let ticks = (await client.ticks(tickQuery)).ticks;
  let length = ticks.length;
  while (length > 0) {
    totalTicks = totalTicks.concat(ticks);
    const lastTick = ticks.slice(-1)[0].entry_price;
    tickQuery["startAfter"] = lastTick;
    ticks = (await client.ticks(tickQuery)).ticks;
    length = ticks.length;
  }
  return totalTicks;
};

const queryAllPositions = async (
  client: MarginedEngineQueryClient,
  vamm: Addr,
  side: MarginedEngineTypes.Side,
  entryPrice: string,
  limit?: number
) => {
  let totalPositions: MarginedEngineTypes.Position[] = [];
  let positionQuery = {
    limit: limit ?? 100,
    orderBy: 1,
    side,
    vamm,
    filter: {
      price: entryPrice,
    },
  };
  let positionsbyPrice = await client.positions(positionQuery);
  let length = positionsbyPrice.length;
  while (length > 0) {
    totalPositions = totalPositions.concat(positionsbyPrice);
    const lastPositionId = positionsbyPrice.slice(-1)[0].position_id;
    positionQuery["startAfter"] = lastPositionId;
    positionsbyPrice = await client.positions(positionQuery);
    length = positionsbyPrice.length;
  }
  return totalPositions;
};

// TODO: write test cases
const calculateSpreadValue = (
  amount: string,
  spread: string,
  decimals: string
) => {
  return (BigInt(amount) * BigInt(spread)) / BigInt(decimals);
};

// TODO: write test cases
const willTpSl = (
  spotPrice: bigint,
  takeProfitValue: bigint,
  stopLossValue: bigint,
  tpSpread: string,
  slSpread: string,
  side: MarginedEngineTypes.Side
) => {
  let a = spotPrice;
  let b = takeProfitValue;
  let c = stopLossValue;
  let d = spotPrice;
  if (side === "sell") {
    a = takeProfitValue;
    b = spotPrice;
    c = spotPrice;
    d = stopLossValue;
  }
  if (
    a >= b ||
    bigAbs(b - a) <= BigInt(tpSpread) ||
    c >= d ||
    (stopLossValue > 0n && bigAbs(d - c) <= BigInt(slSpread))
  ) {
    return true;
  }
  return false;
};

const triggerTpSl = async (
  sender: UserWallet,
  engine: Addr,
  vamm: Addr,
  side: MarginedEngineTypes.Side
): Promise<ExecuteInstruction[]> => {
  console.log("trigger TpSl");
  const multipleMsg: ExecuteInstruction[] = [];
  const engineClient = new MarginedEngineQueryClient(sender.client, engine);
  const vammClient = new MarginedVammQueryClient(sender.client, vamm);

  const config = await engineClient.config();
  const ticks = await queryAllTicks(vamm, engineClient, side);

  const spotPrice = await vammClient.spotPrice();
  for (const tick of ticks) {
    const positionbyPrice = await queryAllPositions(
      engineClient,
      vamm,
      side,
      tick.entry_price
    );

    // TODO: need to refactor and write tests for these
    for (const position of positionbyPrice) {
      // let tp_sl_flag = false;
      const tpSpread = calculateSpreadValue(
        position.take_profit,
        config.tp_sl_spread,
        config.decimals
      );
      const slSpread = calculateSpreadValue(
        position.stop_loss ?? "0",
        config.tp_sl_spread,
        config.decimals
      );
      const willTriggetTpSl = willTpSl(
        BigInt(spotPrice),
        BigInt(position.take_profit),
        BigInt(position.stop_loss ?? "0"),
        tpSpread.toString(),
        slSpread.toString(),
        position.side
      );

      // if (side === "buy") {
      //   if (
      //     spotPrice > Number(position.take_profit) ||
      //     Math.abs(Number(position.take_profit) - spotPrice) <= tp_spread
      //   ) {
      //     tp_sl_flag = true;
      //   } else if (
      //     Number(position.stop_loss) > spotPrice ||
      //     (Number(position.stop_loss) > 0 &&
      //       Math.abs(Number(spotPrice) - Number(position.stop_loss)) <=
      //         sl_spread)
      //   ) {
      //     tp_sl_flag = true;
      //   }
      // } else if (side === "sell") {
      //   if (
      //     Number(position.take_profit) > spotPrice ||
      //     Math.abs(spotPrice - Number(position.take_profit)) <= tp_spread
      //   ) {
      //     tp_sl_flag = true;
      //   } else if (
      //     spotPrice > Number(position.stop_loss) ||
      //     (Number(position.stop_loss) > 0 &&
      //       Math.abs(Number(position.stop_loss) - Number(spotPrice)) <=
      //         sl_spread)
      //   ) {
      //     tp_sl_flag = true;
      //   }
      // }

      if (!willTriggetTpSl) continue;
      let trigger_tp_sl: ExecuteInstruction = {
        contractAddress: engine,
        msg: {
          trigger_tp_sl: {
            position_id: position.position_id,
            quote_asset_limit: "0",
            vamm,
          },
        },
      };
      multipleMsg.push(trigger_tp_sl);
    }
  }

  console.dir(multipleMsg, { depth: 4 });
  return multipleMsg;
};

const triggerLiquidate = async (
  sender: UserWallet,
  engine: Addr,
  vamm: Addr,
  side: MarginedEngineTypes.Side
): Promise<ExecuteInstruction[]> => {
  console.log("trigger Liquidate");
  const engineClient = new MarginedEngineQueryClient(sender.client, engine);
  const multipleMsg: ExecuteInstruction[] = [];
  const engineConfig = await engineClient.config();
  const ticks = await queryAllTicks(vamm, engineClient, side);

  for (const tick of ticks) {
    const positionbyPrice = await queryAllPositions(
      engineClient,
      vamm,
      side,
      tick.entry_price
    );

    for (const position of positionbyPrice) {
      const marginRatio = Number(
        await engineClient.marginRatio({
          positionId: position.position_id,
          vamm,
        })
      );

      let liquidateFlag = false;
      if (marginRatio <= Number(engineConfig.maintenance_margin_ratio)) {
        if (marginRatio > Number(engineConfig.liquidation_fee)) {
          liquidateFlag = true;
        }
      }

      if (liquidateFlag) {
        let liquidate: ExecuteInstruction = {
          contractAddress: engine,
          msg: {
            liquidate: {
              position_id: position.position_id,
              quote_asset_limit: "0", // why limit 0?
              vamm,
            },
          },
        };
        liquidateFlag = false;
        multipleMsg.push(liquidate);
      }
    }
  }

  console.dir(multipleMsg, { depth: 4 });
  return multipleMsg;
};

const payFunding = async (
  sender: UserWallet,
  engine: Addr,
  vamm: Addr
): Promise<ExecuteInstruction[]> => {
  console.log("pay Funding rate");
  const vammClient = new MarginedVammQueryClient(sender.client, vamm);
  const vammState = await vammClient.state();
  const nextFundingTime = Number(vammState.next_funding_time);
  let time = Math.floor(Date.now() / 1000);

  console.log({ vammState });
  console.log({ nextFundingTime });
  if (time >= nextFundingTime) {
    const payFunding: MarginedEngineTypes.ExecuteMsg = {
      pay_funding: {
        vamm,
      },
    };
    return [
      {
        contractAddress: engine,
        msg: payFunding,
      },
    ];
  }
  return [];
};

export async function executeEngine(
  sender: UserWallet,
  engine: Addr,
  insurance: Addr
) {
  console.log(`Excecuting perpetual engine contract ${engine}`);
  const insuranceClient = new MarginedInsuranceFundQueryClient(
    sender.client,
    insurance
  );
  const { vamm_list: vammList } = await insuranceClient.getAllVamm({});
  console.log({ vammList });

  const executePromises = vammList
    .map((item) => [
      triggerTpSl(sender, engine, item, "buy"),
      triggerTpSl(sender, engine, item, "sell"),
      triggerLiquidate(sender, engine, item, "buy"),
      triggerLiquidate(sender, engine, item, "sell"),
      payFunding(sender, engine, item),
    ])
    .flat();

  let instructions: ExecuteInstruction[] = [];
  const results = await Promise.allSettled(executePromises);
  for (let res of results) {
    if (res.status === "fulfilled") {
      instructions = instructions.concat(res.value);
    }
  }
  return sender.client.executeMultiple(sender.address, instructions, "auto");
}
