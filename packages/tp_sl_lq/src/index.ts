import {
  ExecuteInstruction,
    ExecuteResult,
    SigningCosmWasmClient,
} from "@cosmjs/cosmwasm-stargate";

import {
    MarginedInsuranceFundTypes,
    MarginedEngineTypes,
    MarginedVammTypes,
    MarginedPricefeedTypes,
    MarginedFeePoolTypes,
    Side
  } from '@oraichain/oraimargin-contracts-sdk';
import { TickResponse } from "@oraichain/oraimargin-contracts-sdk/build/MarginedEngine.types";
import { log } from "console";
import { UserWallet } from "./helpers";

  const minimumOraiBalance = 1000000; // 1 ORAI;
  
  const runPerpetualEngine = async (
    sender: UserWallet,
    vamm_contractAddr: string,
    engine_contractAddr: string,
    vamm: any,
    side: Side
  ) => {
    console.log({vamm_contractAddr});
    console.log({engine_contractAddr});
    
    const multipleMsg: ExecuteInstruction[] = [];

    const query_config: MarginedEngineTypes.QueryMsg = {
      config: {},
    };
  
    const config = await sender.client.queryContractSmart(engine_contractAddr, query_config);
    console.log({config});
    console.log("tp_sl_spread: ", config.tp_sl_spread);
    console.log("decimals: ", config.decimals);

    const query_ticks: MarginedEngineTypes.QueryMsg = {
      ticks: {
        limit: 100,
        order_by: side === "buy" ? 2 : 1,
        side,
        vamm
      },
    };
    const ticks = await sender.client.queryContractSmart(engine_contractAddr, query_ticks) || [];

    const query_spot_price: MarginedVammTypes.QueryMsg = {
      spot_price: {},
    };

    const spot_price = Number(await sender.client.queryContractSmart(vamm_contractAddr, query_spot_price));
    console.log({spot_price});
    
    console.log({side});
    console.dir(ticks, { depth: 4 });

    for (const tick of ticks.ticks) {
      let tick_price = parseInt(tick.entry_price);
      console.log({tick_price});  
      const query_position_by_price: MarginedEngineTypes.QueryMsg = {
        positions: {
          limit: tick.total_positions,
          order_by : 1,
          side,
          vamm,
          filter: {
            price: tick.entry_price
          }
        },
      };
      const position_by_price = await sender.client.queryContractSmart(engine_contractAddr, query_position_by_price);

      for (const position of position_by_price) {
        console.log({position});
        const tp_spread = Number(position.take_profit)*(Number(config.tp_sl_spread))/Number(config.decimals);
        const sl_spread = Number(position.stop_loss)*(Number(config.tp_sl_spread))/Number(config.decimals);
        console.log({tp_spread, sl_spread});
        let tp_sl_flag = false;
        if (side === "buy") {
          if (spot_price > Number(position.take_profit) || 
            Math.abs(Number(position.take_profit) - spot_price) <= tp_spread) {
            console.log({side}, `position_id: ${position.position_id}`, "trigger take profit");
            tp_sl_flag = true;
          } else if (Number(position.stop_loss) > spot_price ||
            Number(position.stop_loss) > 0 && 
            Math.abs(Number(spot_price) - Number(position.stop_loss)) <= sl_spread) {
            console.log({side}, `position_id: ${position.position_id}`, "trigger stop loss");
            tp_sl_flag = true;
          }
        } else if (side === "sell") {
          if (Number(position.take_profit) > spot_price || 
            Math.abs(spot_price - Number(position.take_profit)) <= tp_spread) {
            console.log({side}, "trigger take profit");
            tp_sl_flag = true;
          } else if (spot_price > Number(position.stop_loss) ||
            Number(position.stop_loss) > 0 && 
            Math.abs(Number(position.stop_loss) - Number(spot_price)) <= sl_spread) {
            console.log({side}, "trigger stop loss");
            tp_sl_flag = true;
          }
        }

        if (tp_sl_flag) {
          console.log("TRIGGER TAKE PROFIT/ STOPLOSS");
          let trigger_tp_sl: ExecuteInstruction = {
            contractAddress: engine_contractAddr,
            msg: {
              trigger_tp_sl: {
                position_id: position.position_id,
                quote_asset_limit: "0",
                vamm
              }
            }
          };
          tp_sl_flag = false;
          multipleMsg.push(trigger_tp_sl);
        }
      }
    }

    console.dir(multipleMsg, { depth: 4 });
    if (multipleMsg.length > 0) {
      try {
        const res = await sender.client.executeMultiple(sender.address, multipleMsg, "auto");
        console.log("take profit & stop loss - txHash:", res.transactionHash);
      } catch (error) {
        console.log({error});          
      }
    }
  };
  
  export const delay = (milliseconds: number) => {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  };
  
  export async function matchingPosition(
    sender: UserWallet,
    engine_contractAddr: string,
    vamm_contractAddr: string,
    insurance_contractAddr: string,
    limit = 30,
    denom = "orai"
  ): Promise<void> {
    const allVamm: MarginedInsuranceFundTypes.QueryMsg = {
      get_all_vamm: {},
    };
    const query_vamms = await sender.client.queryContractSmart(insurance_contractAddr, allVamm);
    console.log({query_vamms})
    console.log(`Excecuting perpetual engine contract ${engine_contractAddr}`);
  
    let execute_vamms: any[] = [];

    query_vamms.vamm_list.forEach((vamm: any) => {
      console.log({ vamm });
      execute_vamms.push(vamm);
    });
  
    const { amount } = await sender.client.getBalance(sender.address, denom);
    console.log(`balance of ${sender.address} is ${amount}`);
    if (parseInt(amount) <= minimumOraiBalance) {
      throw new Error(
        `Balance(${amount}) of ${sender.address} must be greater than 1 ORAI`
      );
    }
    const promiseAllBuy = execute_vamms.map((item) =>
      runPerpetualEngine(sender, vamm_contractAddr, engine_contractAddr, item, "buy")
    );
    (await Promise.all(promiseAllBuy)).filter(Boolean);

    const promiseAllSell = execute_vamms.map((item) =>
      runPerpetualEngine(sender, vamm_contractAddr, engine_contractAddr, item, "sell")
    );
    (await Promise.all(promiseAllSell)).filter(Boolean);
  }
  
