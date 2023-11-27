import { UserWallet, bigAbs } from "@oraichain/oraitrading-common";
import { ExecuteInstruction, ExecuteResult } from "@cosmjs/cosmwasm-stargate";

import {
  Addr,
  MarginedEngineQueryClient,
  MarginedVammQueryClient,
  MarginedInsuranceFundQueryClient,
} from "@oraichain/oraimargin-contracts-sdk";

import {
  Side,
  Position,
  TickResponse,
  ExecuteMsg,
} from "@oraichain/oraimargin-contracts-sdk/build/MarginedEngine.types";
import { IScheduler, Scheduler } from "./scheduler";

export class fetchSchedule extends Scheduler {
  // execute job every 5 minutes
  constructor() {
    super("*/5 * * * *");
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

  calculateSpreadValue = (
    amount: string,
    spread: string,
    decimals: string
  ): bigint => {
    if (decimals === "0") return 0n;
    return (BigInt(amount) * BigInt(spread)) / BigInt(decimals);
  };

  willTpSl = (
    spotPrice: bigint,
    takeProfitValue: bigint,
    stopLossValue: bigint,
    tpSpread: string,
    slSpread: string,
    side: Side
  ): boolean => {
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

  async getAllVamm(): Promise<Addr[]> {
    return (await this.insuranceClient.getAllVamm({})).vamm_list;
  }

  async queryAllTicks(
    vamm: Addr,
    side: Side,
    limit?: number
  ): Promise<TickResponse[]> {
    let totalTicks: TickResponse[] = [];
    let tickQuery = {
      limit: limit ?? 100,
      orderBy: side === "buy" ? 2 : 1,
      side,
      vamm,
    };
    let ticks = (await this.engineClient.ticks(tickQuery)).ticks;
    let length = ticks.length;
    while (length > 0) {
      totalTicks = totalTicks.concat(ticks);
      const lastTick = ticks.slice(-1)[0].entry_price;
      tickQuery["startAfter"] = lastTick;
      ticks = (await this.engineClient.ticks(tickQuery)).ticks;
      length = ticks.length;
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
    let positionQuery = {
      limit: limit ?? 100,
      orderBy: 1,
      side,
      vamm,
      filter: {
        price: entryPrice,
      },
    };
    let positionsbyPrice = await this.engineClient.positions(positionQuery);
    let length = positionsbyPrice.length;
    while (length > 0) {
      totalPositions = totalPositions.concat(positionsbyPrice);
      const lastPositionId = positionsbyPrice.slice(-1)[0].position_id;
      positionQuery["startAfter"] = lastPositionId;
      positionsbyPrice = await this.engineClient.positions(positionQuery);
      length = positionsbyPrice.length;
    }
    return totalPositions;
  }

  async triggerTpSl(
    vamm: Addr,
    side: Side,
    takeProfit: boolean
  ): Promise<ExecuteInstruction[]> {
    const multipleMsg: ExecuteInstruction[] = [];
    const willTriggerTpSl = await this.engineClient.positionIsTpSl({
      vamm,
      side,
      takeProfit,
      limit: 10,
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
          limit: 10,
        },
      },
    };
    multipleMsg.push(trigger_tp_sl);
    return multipleMsg;
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
    const nextFundingTime = Number(vammState.next_funding_time);
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
