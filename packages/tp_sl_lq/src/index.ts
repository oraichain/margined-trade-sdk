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

export const queryAllTicks = async (
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

export const queryPositionsbyPrice = async (
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

export const calculateSpreadValue = (
  amount: string,
  spread: string,
  decimals: string
) => {
  return (BigInt(amount) * BigInt(spread)) / BigInt(decimals);
};

export const willTpSl = (
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
    (stopLossValue > 0 && bigAbs(d - c) <= BigInt(slSpread))
  ) {
    return true;
  }
  return false;
};

export const triggerTpSl = async (
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
    const positionbyPrice = await queryPositionsbyPrice(
      engineClient,
      vamm,
      side,
      tick.entry_price
    );

    // TODO: need to refactor and write tests for these
    for (const position of positionbyPrice) {
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

  return multipleMsg;
};

export const triggerLiquidate = async (
  sender: UserWallet,
  engine: Addr,
  vamm: Addr,
  side: MarginedEngineTypes.Side
): Promise<ExecuteInstruction[]> => {
  console.log("trigger Liquidate");
  const engineClient = new MarginedEngineQueryClient(sender.client, engine);
  const vammClient = new MarginedVammQueryClient(sender.client, vamm);
  const multipleMsg: ExecuteInstruction[] = [];
  const engineConfig = await engineClient.config();
  const ticks = await queryAllTicks(vamm, engineClient, side);

  const isOverSpreadLimit = await vammClient.isOverSpreadLimit();
  console.log({ isOverSpreadLimit });
  for (const tick of ticks) {
    const positionbyPrice = await queryPositionsbyPrice(
      engineClient,
      vamm,
      side,
      tick.entry_price
    );

    for (const position of positionbyPrice) {
      let marginRatio = Number(
        await engineClient.marginRatio({
          positionId: position.position_id,
          vamm,
        })
      );
      console.log({ marginRatio });

      let liquidateFlag = false;
      if (isOverSpreadLimit) {
        const oracleMarginRatio = Number(
          await engineClient.marginRatioByCalcOption({
            vamm,
            positionId: position.position_id,
            calcOption: "oracle",
          })
        );
        console.log({ oracleMarginRatio });
        if (oracleMarginRatio - marginRatio > 0) {
          console.log("UPGRADE MARGIN RATIO value");
          marginRatio = oracleMarginRatio;
          console.log({ marginRatio });
        }
      }
      console.log(
        "maintenance_margin_ratio:",
        engineConfig.maintenance_margin_ratio
      );

      if (marginRatio <= Number(engineConfig.maintenance_margin_ratio)) {
        liquidateFlag = true;
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

export const payFunding = async (
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
  if (instructions.length > 0) {
    return sender.client.executeMultiple(sender.address, instructions, "auto");
  } else {
    throw new Error("No execute instructions messages available");
  }
}
