import { UserWallet, bigAbs } from "@oraichain/oraimargin-common";
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

export class EngineHandler {
  public engineClient: MarginedEngineQueryClient;
  constructor(public sender: UserWallet, private engineAddress: string) {
    this.engineClient = new MarginedEngineQueryClient(
      sender.client,
      engineAddress
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

  async triggerTpSl(vamm: Addr, side: Side, takeProfit: boolean): Promise<ExecuteInstruction[]> {
    const multipleMsg: ExecuteInstruction[] = [];
    const willTriggerTpSl = await this.engineClient.positionIsTpSl({
      vamm,
      side,
      takeProfit: takeProfit,
      limit: 10
    });
    console.log({ side, takeProfit, willTriggerTpSl });
    if (!willTriggerTpSl.is_tpsl) return [];
    let trigger_tp_sl: ExecuteInstruction = {
      contractAddress: this.engineAddress,
      msg: {
        trigger_tp_sl: {
          vamm,
          side,
          take_profit: takeProfit,
          limit: 10
        },
      },
    };
    multipleMsg.push(trigger_tp_sl);

    if (multipleMsg.length > 0)
      console.log("trigger TpSl with length: ", multipleMsg.length);
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
    console.log({ isOverSpreadLimit });
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
        console.log({ position });
        console.log({ marginRatio });
        let liquidateFlag = false;
        if (isOverSpreadLimit) {
          const oracleMarginRatio = Number(
            await this.engineClient.marginRatioByCalcOption({
              vamm,
              positionId: position.position_id,
              calcOption: "oracle",
            })
          );
          console.log({ oracleMarginRatio, marginRatio });
          if (oracleMarginRatio - marginRatio > 0) {
            marginRatio = oracleMarginRatio;
            console.log("new marginRatio: " + marginRatio);
          }
        }
        console.log("engineConfig.maintenance_margin_ratio: " + engineConfig.maintenance_margin_ratio);
        if (marginRatio <= Number(engineConfig.maintenance_margin_ratio)) {
          console.log("LIQUIDATE - POSITION: ", position.position_id);
          liquidateFlag = true;
        }

        if (liquidateFlag) {
          let liquidate: ExecuteInstruction = {
            contractAddress: this.engineAddress,
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
    if (multipleMsg.length > 0)
      console.log(
        "trigger Liquidate with total message length: ",
        multipleMsg.length
      );
    return multipleMsg;
  }

  async payFunding(vamm: Addr): Promise<ExecuteInstruction[]> {
    const vammClient = new MarginedVammQueryClient(this.sender.client, vamm);
    const vammState = await vammClient.state();
    const nextFundingTime = Number(vammState.next_funding_time);
    let time = Math.floor(Date.now() / 1000);

    if (time >= nextFundingTime) {
      const payFunding: ExecuteMsg = {
        pay_funding: {
          vamm,
        },
      };
      console.log("pay Funding rate");
      return [
        {
          contractAddress: this.engineAddress,
          msg: payFunding,
        },
      ];
    }
    return [];
  }
}

export async function executeEngine(
  sender: UserWallet,
  engine: Addr,
  insurance: Addr
): Promise<ExecuteResult> | undefined {
  console.log(`Excecuting perpetual engine contract ${engine}`);
  const insuranceClient = new MarginedInsuranceFundQueryClient(
    sender.client,
    insurance
  );
  const { vamm_list: vammList } = await insuranceClient.getAllVamm({});

  const engineHandler = new EngineHandler(sender, engine);
  const executePromises = vammList
    .map((item) => [
      engineHandler.triggerTpSl(item, "buy", true),
      engineHandler.triggerTpSl(item, "buy", false),
      engineHandler.triggerTpSl(item, "sell", true),
      engineHandler.triggerTpSl(item, "sell", false),
      engineHandler.triggerLiquidate(item, "buy"),
      engineHandler.triggerLiquidate(item, "sell"),
      engineHandler.payFunding(item),
    ])
    .flat();

  let instructions: ExecuteInstruction[] = [];
  const results = await Promise.allSettled(executePromises);
  for (let res of results) {
    if (res.status === "fulfilled") {
      instructions = instructions.concat(res.value);
    }
  }
  console.log("instructions to execute: ");
  console.dir(instructions, { depth: 4 });
  if (instructions.length > 0)
    return engineHandler.executeMultiple(instructions);
}
