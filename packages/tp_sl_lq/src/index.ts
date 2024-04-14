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
  PositionFilter,
} from "@oraichain/oraimargin-contracts-sdk/build/MarginedEngine.types";
import { IScheduler, Scheduler } from "./scheduler";
import { WebhookClient, time } from "discord.js";

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

  calculateSpreadValue = (
    amount: string,
    spread: string,
    decimals: string
  ): bigint => {
    if (decimals === "0" || !amount) return 0n;
    return (BigInt(amount) * BigInt(spread)) / BigInt(decimals);
  };

  willTpSl(
    closePrice: bigint,
    takeProfit: bigint,
    stopLoss: bigint,
    tpSpread: bigint,
    slSpread: bigint,
    side: Side
  ) {
    let msg: String = "";
    const tpCloseSpread = bigAbs(takeProfit - closePrice);
    const slCloseSpread = bigAbs(stopLoss - closePrice);
    // if spot_price is ~ take_profit or stop_loss, close position
    if (side === "buy") {
      if (
        (takeProfit > 0 && closePrice > takeProfit) ||
        tpCloseSpread <= tpSpread
      ) {
        msg = "trigger_take_profit";
      } else if (stopLoss > closePrice || slCloseSpread <= slSpread) {
        msg = "trigger_stop_loss";
      }
    } else if (side === "sell") {
      if (takeProfit > closePrice || tpCloseSpread <= tpSpread) {
        msg = "trigger_take_profit";
      } else if (
        (closePrice > stopLoss && stopLoss > 0) ||
        slCloseSpread <= slSpread
      ) {
        msg = "trigger_stop_loss";
      }
    }
    return msg;
  }

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

  async queryPositions(
    vamm: Addr,
    side: Side,
    limit?: number
  ): Promise<Position[]> {
    let totalPositions: Position[] = [];
    let positionQuery = {
      limit: limit ?? 100,
      orderBy: 1,
      side,
      vamm,
      filter: "none" as PositionFilter,
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

  async triggerTpSl(vamm: Addr, side: Side): Promise<String[]> {
    const vammClient = new MarginedVammQueryClient(this.sender.client, vamm);
    const vammConfig = await vammClient.config();
    const config = await this.engineClient.config();
    let result: String[] = [];
    const positions = await this.queryPositions(vamm, side);
    for (const position of positions) {
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
      const baseAmount = Math.abs(Number(position.size));
      const closePrice = await vammClient.outputPrice({
        amount: baseAmount.toString(),
        direction: position.direction,
      });

      const willTriggetTpSl = this.willTpSl(
        BigInt(closePrice),
        BigInt(position.take_profit ?? "0"),
        BigInt(position.stop_loss ?? "0"),
        BigInt(tpSpread.toString()),
        BigInt(slSpread.toString()),
        position.side
      );
      console.log({
        positionId: position.position_id,
        pair: `${vammConfig.base_asset}/${vammConfig.quote_asset}`,
      });
      let takeProfit = false;
      if (willTriggetTpSl === "") continue;
      else if (willTriggetTpSl === "trigger_take_profit") {
        takeProfit = true;
      } else if (willTriggetTpSl === "trigger_stop_loss") {
        takeProfit = false;
      }
      let trigger_tp_sl: ExecuteInstruction = {
        contractAddress: this.engine,
        msg: {
          trigger_tp_sl: {
            vamm,
            position_id: position.position_id,
            take_profit: takeProfit,
          },
        } as ExecuteMsg,
      };
      try {
        const res = await this.executeMultiple([trigger_tp_sl]);
        if (res) {
          console.log(
            `${willTriggetTpSl} of position_id: ${position.position_id} - txHash:`,
            res.transactionHash
          );
          result.push(
            `pair: ${vammConfig.base_asset}/${
              vammConfig.quote_asset
            } - ${willTriggetTpSl.toUpperCase()} - position_id: ${
              position.position_id
            } - txHash: ${res.transactionHash}`
          );
        }
      } catch (error) {
        console.log({ error });
      }
    }
    return result;
  }

  async triggerLiquidate(vamm: Addr, side: Side): Promise<String[]> {
    let whitelistedTrader = process.env.WHITELIST_TRADER?.split(",") || [];

    const vammClient = new MarginedVammQueryClient(this.sender.client, vamm);
    const engineConfig = await this.engineClient.config();
    const isOverSpreadLimit = await vammClient.isOverSpreadLimit();
    const vammConfig = await vammClient.config();
    console.log({ side, isOverSpreadLimit });
    let result: String[] = [];
    const positions = await this.queryPositions(vamm, side);
    for (const position of positions) {
      if (whitelistedTrader.includes(position.trader)) {
        continue;
      }
      let marginRatio = Number(
        await this.engineClient.marginRatio({
          positionId: position.position_id,
          vamm,
        })
      );
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
        const liquidate: ExecuteInstruction = {
          contractAddress: this.engine,
          msg: {
            liquidate: {
              position_id: position.position_id,
              quote_asset_limit: "0",
              vamm,
            },
          } as ExecuteMsg,
        };
        liquidateFlag = false;
        try {
          const res = await this.executeMultiple([liquidate]);
          if (res) {
            console.log(
              `LIQUIDATE - position_id: ${position.position_id} - txHash:`,
              res.transactionHash
            );
            result.push(
              `pair: ${vammConfig.base_asset}/${vammConfig.quote_asset} - LIQUIDATE - position_id: ${position.position_id} - txHash: ${res.transactionHash}`
            );
          }
        } catch (error) {
          console.log({ error });
        }
      }
    }
    return result;
  }

  async payFunding(vamm: Addr): Promise<String[]> {
    const vammClient = new MarginedVammQueryClient(this.sender.client, vamm);
    const vammState = await vammClient.state();
    const nextFundingTime = Number(vammState.next_funding_time);
    const vammConfig = await vammClient.config();
    let time = Math.floor(Date.now() / 1000);
    console.log({ time, nextFundingTime });
    let result: String[] = [];

    if (time >= nextFundingTime) {
      const payFunding: ExecuteInstruction = {
        contractAddress: this.engine,
        msg: {
          pay_funding: {
            vamm,
          },
        } as ExecuteMsg,
      };
      console.log("pay Funding rate");
      try {
        const res = await this.executeMultiple([payFunding]);
        if (res) {
          console.log(`PAYFUNDING - txHash:`, res.transactionHash);
          result.push(
            `pair: ${vammConfig.base_asset}/${vammConfig.quote_asset} - PAYFUNDING - txHash: ${res.transactionHash}`
          );
        }
      } catch (error) {
        console.log({ error });
      }
    }
    return result;
  }
}

export async function executeEngine(
  engineHandler: EngineHandler
): Promise<[String[], String[], String[]]> {
  const vammList = [
    "orai1hgc4tmvuj6zuagyjpjjdrgwzj6ncgclm0n6rn4vwjg3wdxxyq0fs9k3ps9",
    "orai1rujsndzwez98c9wg8vfp0fcjfeprddnlud5dweesd3j0qume9nzqvs0ykn",
    "orai13ma2kawhdhtec9vg75h35wnvtsvmsse8wpltt28st2zyevgwnceqc806jq",
  ];

  let tpslRes: String[] = [];
  let liquidateRes: String[] = [];
  let payFundingRes: String[] = [];

  const executeLiquidatePromises = vammList
    .map((item) => [
      engineHandler.triggerLiquidate(item, "buy"),
      engineHandler.triggerLiquidate(item, "sell"),
    ])
    .flat();

  const executeTPSLPromises = vammList
    .map((item) => [
      engineHandler.triggerTpSl(item, "buy"),
      engineHandler.triggerTpSl(item, "sell"),
    ])
    .flat();

  const executePayFundingPromises = vammList
    .map((item) => [engineHandler.payFunding(item)])
    .flat();

  const liquidateResults = await Promise.allSettled(executeLiquidatePromises);
  const tpslResults = await Promise.allSettled(executeTPSLPromises);
  const payFundingResults = await Promise.allSettled(executePayFundingPromises);

  for (let res of tpslResults) {
    if (res.status === "fulfilled") {
      tpslRes = tpslRes.concat(res.value);
    }
  }
  for (let res of liquidateResults) {
    if (res.status === "fulfilled") {
      liquidateRes = liquidateRes.concat(res.value);
    }
  }
  for (let res of payFundingResults) {
    if (res.status === "fulfilled") {
      payFundingRes = payFundingRes.concat(res.value);
    }
  }
  return [tpslRes, liquidateRes, payFundingRes];
}
