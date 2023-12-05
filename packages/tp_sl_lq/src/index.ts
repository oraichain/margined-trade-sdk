import { UserWallet, bigAbs } from "@oraichain/oraitrading-common";
import { ExecuteInstruction, ExecuteResult } from "@cosmjs/cosmwasm-stargate";

import {
  Addr,
  MarginedEngineQueryClient,
  MarginedVammQueryClient,
  MarginedInsuranceFundQueryClient,
  Direction,
} from "@oraichain/oraimargin-contracts-sdk";

import {
  Side,
  Position,
  TickResponse,
  ExecuteMsg,
  PositionFilter,
} from "@oraichain/oraimargin-contracts-sdk/build/MarginedEngine.types";
import { IScheduler, Scheduler } from "./scheduler";

import { time } from "discord.js";
import { BigNumber } from "bignumber.js";
export class fetchSchedule extends Scheduler {
  // execute job every 3 minutes
  constructor() {
    super("*/3 * * * *");
  }

  executeJob(): Promise<IScheduler> {
    return new Promise(async (resolve, reject) => {
      await fetch("https://bot-test.orai.io/bot-futures/");
      console.log(`Fetch server at ` + new Date());
    });
  }
}

export class EngineHandler {
  public engineClient: MarginedEngineQueryClient;
  public insuranceClient: MarginedInsuranceFundQueryClient;
  constructor(
    public sender: UserWallet,
    private engine: string,
    private insurance: string
  ) {
    this.engineClient = new MarginedEngineQueryClient(sender.client, engine);
    this.insuranceClient = new MarginedInsuranceFundQueryClient(
      sender.client,
      insurance
    );
  }

  async getNativeBalance(address?: string, denom?: string) {
    const balance = await this.sender.client.getBalance(
      address ?? this.sender.address,
      denom ?? "orai"
    );
    return BigInt(balance.amount);
  }

  async executeMultiple(instructions: ExecuteInstruction[]) {
    return this.sender.client.executeMultiple(
      this.sender.address,
      instructions,
      "auto"
    );
  }

  async decimals() {
    const engineConfig = await this.engineClient.config();
    return engineConfig.decimals;
  }

  calculateSpreadValue = (
    amount: string,
    spread: string,
    decimals: string
  ): bigint => {
    if (decimals === "0") return 0n;
    return (BigInt(amount) * BigInt(spread)) / BigInt(decimals);
  };

  willTpSl = (
    closePrice: bigint,
    takeProfitValue: bigint,
    stopLossValue: bigint,
    tpSpread: string,
    slSpread: string,
    side: Side
  ): boolean => {
    let a = closePrice;
    let b = takeProfitValue;
    let c = stopLossValue;
    let d = closePrice;
    if (side === "sell") {
      a = takeProfitValue;
      b = closePrice;
      c = closePrice;
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

  async getAllVamm(): Promise<Addr[]> {
    return (await this.insuranceClient.getAllVamm({})).vamm_list;
  }

  async queryAllTicks(
    vamm: Addr,
    side: Side,
    limit?: number
  ): Promise<TickResponse[]> {
    let totalTicks: TickResponse[] = [];
    let queryMsg = {
      limit: limit ?? 100,
      orderBy: side === "buy" ? 2 : 1,
      side,
      vamm,
    };
    let ticks = await this.engineClient.ticks(queryMsg);
    while (ticks.ticks.length > 0) {
      totalTicks.push(...ticks.ticks);
      queryMsg["startAfter"] = ticks.ticks.pop().entry_price;
      ticks = await this.engineClient.ticks(queryMsg);
    }
    return totalTicks;
  }

  async queryPositionsbyPrice(
    vamm: Addr,
    side: Side,
    entryPrice: string,
    limit?: number
  ): Promise<Position[]> {
    let totalPositions: Position[] = [];
    let queryMsg = {
      limit: limit ?? 100,
      orderBy: 1,
      side,
      vamm,
      filter: {
        price: entryPrice,
      },
    };
    let positions = await this.engineClient.positions(queryMsg);
    while (positions.length > 0) {
      totalPositions.push(...positions);
      queryMsg["startAfter"] = positions.pop().position_id;
      positions = await this.engineClient.positions(queryMsg);
    }
    return totalPositions;
  }

  async queryPostions(vamm: Addr, side: Side): Promise<Position[]> {
    let totalPositions: Position[] = [];
    let positionQuery = {
      orderBy: 1,
      vamm,
      side,
      filter: "none" as PositionFilter,
    };
    let positions = await this.engineClient.positions(positionQuery);
    while (positions.length > 0) {
      totalPositions.push(...positions);
      positionQuery["startAfter"] = positions.pop().position_id;
      positions = await this.engineClient.positions(positionQuery);
    }
    return totalPositions;
  }

  async simulateClosePrice(baseAssetAmount: number, direction: Direction, vamm: Addr): Promise<BigNumber> {
    const decimals = new BigNumber(await this.decimals());
    const vammClient = new MarginedVammQueryClient(this.sender.client, vamm);
    const state = await vammClient.state();
    // let quoteAssetReserve = new BigNumber(state.quote_asset_reserve);
    // let baseAssetReserve = new BigNumber(state.base_asset_reserve);
    const quoteAssetAmount = new BigNumber(
      await vammClient.outputAmount({
        amount: baseAssetAmount.toString(),
        direction
      })
    );
    // const update_direction = direction === "add_to_amm" ? "remove_from_amm" : "add_to_amm";
    // if (update_direction === "add_to_amm") {
    //   quoteAssetReserve = quoteAssetReserve.plus(quoteAssetAmount);
    //   baseAssetReserve = baseAssetReserve.minus(baseAssetAmount);
    // } else {
    //   quoteAssetReserve = quoteAssetReserve.minus(quoteAssetAmount);
    //   baseAssetReserve = baseAssetReserve.plus(baseAssetAmount);
    // }
    return quoteAssetAmount.multipliedBy(decimals).dividedBy(baseAssetAmount);
  }

  async triggerNewTpSl(
    vamm: Addr,
    side: Side,
    takeProfit: boolean
  ): Promise<ExecuteInstruction[]> {
    const date = new Date();
    let result = "";
    let takeProfitMsg = "";

    const multipleMsg: ExecuteInstruction[] = [];
    const vammClient = new MarginedVammQueryClient(this.sender.client, vamm);
    const config = await this.engineClient.config();
    const ticks = await this.queryAllTicks(vamm, side);
    const spotPrice = await vammClient.spotPrice();
    for (const tick of ticks) {
      const positionbyPrice = await this.queryPositionsbyPrice(
        vamm,
        side,
        tick.entry_price
      );
      for (const position of positionbyPrice) {
        const tpSpread = this.calculateSpreadValue(
          position.take_profit,
          config.tp_sl_spread,
          config.decimals
        );
        const slSpread = this.calculateSpreadValue(
          position.stop_loss ?? "0",
          config.tp_sl_spread,
          config.decimals
        );
        const willTriggetTpSl = this.willTpSl(
          BigInt(spotPrice),
          BigInt(position.take_profit),
          BigInt(position.stop_loss ?? "0"),
          tpSpread.toString(),
          slSpread.toString(),
          position.side
        );

        if (!willTriggetTpSl) continue;
        let trigger_tp_sl: ExecuteInstruction = {
          contractAddress: this.engineClient.contractAddress,
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
  }

  async triggerTpSl(
    vamm: Addr,
    side: Side,
    takeProfit: boolean
  ): Promise<ExecuteInstruction[]> {
    const date = new Date();
    let result = "";
    let takeProfitMsg = "";

    const multipleMsg: ExecuteInstruction[] = [];
    const willTriggerTpSl = await this.engineClient.positionIsTpSl({
      vamm,
      side,
      takeProfit,
      limit: 5,
    });
    console.log(
      `TP | SL - POSITION: ${side} - takeProfit: ${takeProfit} - is_tpsl: ${willTriggerTpSl.is_tpsl}`
    );
    if (!willTriggerTpSl.is_tpsl) return [];
    let trigger_tp_sl: ExecuteInstruction = {
      contractAddress: this.engine,
      msg: {
        trigger_tp_sl: {
          vamm,
          side,
          take_profit: takeProfit,
          limit: 5,
        },
      },
    };
    multipleMsg.push(trigger_tp_sl);
    return multipleMsg;
    // if (multipleMsg.length > 0) {
    //   console.dir(multipleMsg, { depth: 4 });
    //   const res = await this.executeMultiple(multipleMsg);
    //   if (res !== undefined) {
    //     console.log(
    //       "take profit | stop loss - txHash:",
    //       res.transactionHash
    //     );
    //     result = result + `:receipt: BOT: ${this.sender.address} - take profit | stop loss - txHash: ${res.transactionHash}` + ` at ${time(date)}`;
    //   }
    // }
    // return result;
  }

  async triggerLiquidate(
    vamm: Addr,
    side: Side
  ): Promise<ExecuteInstruction[]> {
    const vammClient = new MarginedVammQueryClient(this.sender.client, vamm);
    const multipleMsg: ExecuteInstruction[] = [];
    const engineConfig = await this.engineClient.config();
    const ticks = await this.queryAllTicks(vamm, side);
    const isOverSpreadLimit = await vammClient.isOverSpreadLimit();
    console.log({ side, isOverSpreadLimit });
    for (const tick of ticks) {
      const positionbyPrice = await this.queryPositionsbyPrice(
        vamm,
        side,
        tick.entry_price
      );

      for (const position of positionbyPrice) {
        let marginRatio = Number(
          await this.engineClient.marginRatio({
            positionId: position.position_id,
            vamm,
          })
        );
        // console.log({
        //   position_id: position.position_id,
        //   marginRatio,
        //   maintenance_margin_ratio: engineConfig.maintenance_margin_ratio,
        // });
        let liquidateFlag = false;
        if (isOverSpreadLimit) {
          const oracleMarginRatio = Number(
            await this.engineClient.marginRatioByCalcOption({
              vamm,
              positionId: position.position_id,
              calcOption: "oracle",
            })
          );
          console.log({ oracleMarginRatio });
          if (oracleMarginRatio - marginRatio > 0) {
            marginRatio = oracleMarginRatio;
            console.log({ new_marginRatio: marginRatio });
          }
        }
        if (marginRatio <= Number(engineConfig.maintenance_margin_ratio)) {
          console.log("LIQUIDATE - POSITION:", position.position_id);
          liquidateFlag = true;
        }

        if (liquidateFlag) {
          let liquidate: ExecuteInstruction = {
            contractAddress: this.engine,
            msg: {
              liquidate: {
                position_id: position.position_id,
                quote_asset_limit: "0",
                vamm,
              },
            },
          };
          liquidateFlag = false;
          multipleMsg.push(liquidate);
        }
      }
    }
    return multipleMsg;
  }

  async payFunding(vamm: Addr): Promise<ExecuteInstruction[]> {
    const vammClient = new MarginedVammQueryClient(this.sender.client, vamm);
    const vammState = await vammClient.state();
    const nextFundingTime = Number(vammState.next_funding_time) + 6;
    let time = Math.floor(Date.now() / 1000);
    console.log({ time, nextFundingTime });
    if (time >= nextFundingTime) {
      const payFunding: ExecuteMsg = {
        pay_funding: {
          vamm,
        },
      };
      console.log("pay Funding rate");
      return [
        {
          contractAddress: this.engine,
          msg: payFunding,
        },
      ];
    }
    return [];
  }
}

export async function executeEngine(
  engineHandler: EngineHandler
): Promise<[ExecuteInstruction[], ExecuteInstruction[], ExecuteInstruction[]]> {
  const vammList: Addr[] = await engineHandler.getAllVamm();
  const executeTPSLPromises = vammList
    .map((item) => [
      engineHandler.triggerTpSl(item, "buy", true),
      engineHandler.triggerTpSl(item, "buy", false),
      engineHandler.triggerTpSl(item, "sell", true),
      engineHandler.triggerTpSl(item, "sell", false),
    ])
    .flat();

  const executeLiquidatePromises = vammList
    .map((item) => [
      engineHandler.triggerLiquidate(item, "buy"),
      engineHandler.triggerLiquidate(item, "sell"),
    ])
    .flat();

  const executePayFundingPromises = vammList
    .map((item) => [engineHandler.payFunding(item)])
    .flat();

  let tpslMsg: ExecuteInstruction[] = [];
  let liquidateMsg: ExecuteInstruction[] = [];
  let payFundingMsg: ExecuteInstruction[] = [];
  const tpslResults = await Promise.allSettled(executeTPSLPromises);
  for (let res of tpslResults) {
    if (res.status === "fulfilled") {
      tpslMsg = tpslMsg.concat(res.value);
    }
  }

  const liquidateResults = await Promise.allSettled(executeLiquidatePromises);
  for (let res of liquidateResults) {
    if (res.status === "fulfilled") {
      liquidateMsg = liquidateMsg.concat(res.value);
    }
  }

  const payFundingResults = await Promise.allSettled(executePayFundingPromises);
  for (let res of payFundingResults) {
    if (res.status === "fulfilled") {
      payFundingMsg = payFundingMsg.concat(res.value);
    }
  }
  return [tpslMsg, liquidateMsg, payFundingMsg];
}
