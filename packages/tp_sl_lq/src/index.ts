import { UserWallet } from "@oraichain/oraimargin-common";

import { ExecuteInstruction } from "@cosmjs/cosmwasm-stargate";

import {
  MarginedEngineTypes,
  Addr,
  MarginedEngineQueryClient,
  MarginedVammQueryClient,
  MarginedInsuranceFundQueryClient,
} from "@oraichain/oraimargin-contracts-sdk";

export class TpSlHandler {}

const triggerTpSl = async (
  sender: UserWallet,
  engine: Addr,
  vamm: Addr,
  side: MarginedEngineTypes.Side
): Promise<ExecuteInstruction[]> => {
  console.log("trigger TpSl");
  const multipleMsg: ExecuteInstruction[] = [];
  const margineClient = new MarginedEngineQueryClient(sender.client, engine);
  const vammClient = new MarginedVammQueryClient(sender.client, vamm);

  const config = await margineClient.config();
  const ticks = await margineClient.ticks({
    limit: 100, // TODO: why only limit 100?
    orderBy: side === "buy" ? 2 : 1,
    side,
    vamm,
  });

  const spotPrice = Number(await vammClient.spotPrice());

  for (const tick of ticks.ticks) {
    const positionbyPrice = await margineClient.positions({
      limit: tick.total_positions,
      orderBy: 1,
      side,
      vamm,
      filter: {
        price: tick.entry_price,
      },
    });

    // TODO: need to refactor and write tests for these
    for (const position of positionbyPrice) {
      let tp_sl_flag = false;
      const tp_spread =
        (Number(position.take_profit) * Number(config.tp_sl_spread)) /
        Number(config.decimals);
      const sl_spread =
        (Number(position.stop_loss) * Number(config.tp_sl_spread)) /
        Number(config.decimals);

      if (side === "buy") {
        if (
          spotPrice > Number(position.take_profit) ||
          Math.abs(Number(position.take_profit) - spotPrice) <= tp_spread
        ) {
          tp_sl_flag = true;
        } else if (
          Number(position.stop_loss) > spotPrice ||
          (Number(position.stop_loss) > 0 &&
            Math.abs(Number(spotPrice) - Number(position.stop_loss)) <=
              sl_spread)
        ) {
          tp_sl_flag = true;
        }
      } else if (side === "sell") {
        if (
          Number(position.take_profit) > spotPrice ||
          Math.abs(spotPrice - Number(position.take_profit)) <= tp_spread
        ) {
          tp_sl_flag = true;
        } else if (
          spotPrice > Number(position.stop_loss) ||
          (Number(position.stop_loss) > 0 &&
            Math.abs(Number(position.stop_loss) - Number(spotPrice)) <=
              sl_spread)
        ) {
          tp_sl_flag = true;
        }
      }

      if (tp_sl_flag) {
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
        tp_sl_flag = false;
        multipleMsg.push(trigger_tp_sl);
      }
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
  const margineClient = new MarginedEngineQueryClient(sender.client, engine);
  const multipleMsg: ExecuteInstruction[] = [];
  const engineConfig = await margineClient.config();
  const ticks = await margineClient.ticks({
    limit: 100, // TODO: why only limit 100?
    orderBy: side === "buy" ? 1 : 2, // while changing order by here
    side,
    vamm,
  });
  console.log({ side });
  console.dir(ticks, { depth: 4 });

  for (const tick of ticks.ticks) {
    const positionbyPrice = await margineClient.positions({
      limit: tick.total_positions,
      orderBy: 1,
      side,
      vamm,
      filter: {
        price: tick.entry_price,
      },
    });

    for (const position of positionbyPrice) {
      const marginRatio = Number(
        await margineClient.marginRatio({
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
  console.log({ vammState });
  const nextFundingTime = Number(vammState.next_funding_time);
  console.log({ nextFundingTime });
  let time = Math.floor(Date.now() / 1000);

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
): Promise<void> {
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
  try {
    const res = await sender.client.executeMultiple(
      sender.address,
      instructions,
      "auto"
    );
    console.log("take profit & stop loss - txHash:", res.transactionHash);
  } catch (error) {
    // TODO: add send noti to discord
    console.log(
      "error in processing triggering TpSl, liquidate & pay funding: ",
      { error }
    );
  }
}
