import { UserWallet } from "@oraichain/oraimargin-common";

import { ExecuteInstruction } from "@cosmjs/cosmwasm-stargate";

import {
  MarginedInsuranceFundTypes,
  MarginedEngineTypes,
  MarginedVammTypes,
  Addr,
} from "@oraichain/oraimargin-contracts-sdk";

const triggerTpSl = async (
  sender: UserWallet,
  engine: Addr,
  vamm: Addr,
  side: MarginedEngineTypes.Side
) => {
  console.log("trigger TpSl");
  const multipleMsg: ExecuteInstruction[] = [];
  const query_config: MarginedEngineTypes.QueryMsg = {
    config: {},
  };

  const config = await sender.client.queryContractSmart(
    engine,
    query_config
  );

  const queryTicks: MarginedEngineTypes.QueryMsg = {
    ticks: {
      limit: 100,
      order_by: side === "buy" ? 2 : 1,
      side,
      vamm,
    },
  };
  const ticks =
    (await sender.client.queryContractSmart(
      engine,
      queryTicks
    )) || [];

  const querySpotPrice: MarginedVammTypes.QueryMsg = {
    spot_price: {},
  };

  const spotPrice = Number(
    await sender.client.queryContractSmart(vamm, querySpotPrice)
  );

  for (const tick of ticks.ticks) {
    const queryPositionbyPrice: MarginedEngineTypes.QueryMsg = {
      positions: {
        limit: tick.total_positions,
        order_by: 1,
        side,
        vamm,
        filter: {
          price: tick.entry_price,
        },
      },
    };
    const positionbyPrice = await sender.client.queryContractSmart(
      engine,
      queryPositionbyPrice
    );

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
  if (multipleMsg.length > 0) {
    console.log("TRIGGER TAKE PROFIT / STOPLOSS");
    try {
      const res = await sender.client.executeMultiple(
        sender.address,
        multipleMsg,
        "auto"
      );
      console.log("take profit & stop loss - txHash:", res.transactionHash);
    } catch (error) {
      console.log({ error });
    }
  }
};

const triggerLiquidate = async (
  sender: UserWallet,
  engine: Addr,
  vamm: Addr,
  side: MarginedEngineTypes.Side
) => {
  console.log("trigger Liquidate");
  const multipleMsg: ExecuteInstruction[] = [];

  const queryEngineConfig: MarginedEngineTypes.QueryMsg = {
    config: {},
  };

  const engineConfig = await sender.client.queryContractSmart(
    engine,
    queryEngineConfig
  );

  const queryTicks: MarginedEngineTypes.QueryMsg = {
    ticks: {
      limit: 100,
      order_by: side === "buy" ? 1 : 2,
      side,
      vamm,
    },
  };
  const ticks =
    (await sender.client.queryContractSmart(
      engine,
      queryTicks
    )) || [];

  console.log({ side });
  console.dir(ticks, { depth: 4 });

  for (const tick of ticks.ticks) {
    const queryPositionbyPrice: MarginedEngineTypes.QueryMsg = {
      positions: {
        limit: tick.total_positions,
        order_by: 1,
        side,
        vamm,
        filter: {
          price: tick.entry_price,
        },
      },
    };
    const positionbyPrice = await sender.client.queryContractSmart(
      engine,
      queryPositionbyPrice
    );

    for (const position of positionbyPrice) {
      const queryMarginRatio: MarginedEngineTypes.QueryMsg = {
        margin_ratio: {
          position_id: position.position_id,
          vamm,
        },
      };

      const marginRatio = Number(
        await sender.client.queryContractSmart(
          engine,
          queryMarginRatio
        )
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
  if (multipleMsg.length > 0) {
    console.log("TRIGGER LIQUIDATE");
    try {
      const res = await sender.client.executeMultiple(
        sender.address,
        multipleMsg,
        "auto"
      );
      console.log("liquidate - txHash:", res.transactionHash);
    } catch (error) {
      console.log({ error });
    }
  }
};

const payFunding = async (
  sender: UserWallet,
  engine: Addr,
  vamm: Addr
) => {
  console.log("pay Funding rate");
  const queryVammState: MarginedVammTypes.QueryMsg = {
    state: {},
  };
  const vammState = await sender.client.queryContractSmart(
    vamm,
    queryVammState
  );
  console.log({ vammState });
  const nextFundingTime = Number(vammState.next_funding_time);
  console.log({ nextFundingTime });
  let time = Math.floor(Date.now() / 1000);
  
  if (time >= nextFundingTime) {
    const payFunding: MarginedEngineTypes.ExecuteMsg = {
      pay_funding: {
        vamm
      }
    };

    try {
      const res = await sender.client.execute(
        sender.address,
        engine,
        payFunding,
        "auto"
      );
      console.log("payFunding - txHash:", res.transactionHash);
    } catch (error) {
      console.log({ error });
    }
  }
};

export async function executeEngine(
  sender: UserWallet,
  engine: Addr,
  insurance: Addr
): Promise<void> {
  console.log(`Excecuting perpetual engine contract ${engine}`);

  const queryAllVamms: MarginedInsuranceFundTypes.QueryMsg = {
    get_all_vamm: {},
  };
  const allVamms = await sender.client.queryContractSmart(
    insurance,
    queryAllVamms
  );
  console.log({ allVamms });

  let execute_vamms: any[] = [];

  allVamms.vamm_list.forEach((vamm: any) => {
    console.log({ vamm });
    execute_vamms.push(vamm);
  });

  const promiseBuyTpSl = execute_vamms.map((item) =>
    triggerTpSl(sender, engine, item, "buy")
  );
  const promiseSellTpSl = execute_vamms.map((item) =>
    triggerTpSl(sender, engine, item, "sell")
  );
  const promiseBuyLiquidate = execute_vamms.map((item) =>
    triggerLiquidate(sender, engine, item, "buy")
  );
  const promiseSellLiquidate = execute_vamms.map((item) =>
    triggerLiquidate(sender, engine, item, "sell")
  );

  const payFundingRate = execute_vamms.map((item) =>
    payFunding(sender, engine, item)
  )

  await Promise.all([
    Promise.all(promiseBuyTpSl),
    Promise.all(promiseSellTpSl),
    Promise.all(promiseBuyLiquidate),
    Promise.all(promiseSellLiquidate),
    Promise.all(payFundingRate),
  ]);
}
