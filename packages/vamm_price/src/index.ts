import WebSocket from 'ws';

import { UserWallet } from "./helpers";

import {
  MarginedInsuranceFundTypes,
  MarginedVammTypes,
  Addr
} from '@oraichain/oraimargin-contracts-sdk';

const wss = new WebSocket.Server({ port: 3001 });

const querySpotPrice = async (
  sender: UserWallet,
  vamm: Addr,
): Promise<string> => {
  let time = Math.floor(Date.now() / 1000);

  const queryConfig: MarginedVammTypes.QueryMsg = {
    config: {},
  };
  const vammConfig = await sender.client.queryContractSmart(vamm, queryConfig);

  const query_spot_price: MarginedVammTypes.QueryMsg = {
    spot_price: {},
  };
  const spotPrice = Number(await sender.client.queryContractSmart(vamm, query_spot_price));
  const pairPrice = JSON.stringify({
    event: "market_price",
    pair: `${vammConfig.base_asset}/${vammConfig.quote_asset}`,
    spot_price: spotPrice,
    time
  });

  console.log({ pairPrice });
  wss.clients.forEach(ws => {
    ws.send(pairPrice)
  })
  return pairPrice
};

export async function queryAllVammSpotPrice(
  sender: UserWallet,
  insurance_contractAddr: string
): Promise<string[]> {
  const queryAllVamms: MarginedInsuranceFundTypes.QueryMsg = {
    get_all_vamm: {},
  };
  const allVamms = await sender.client.queryContractSmart(insurance_contractAddr, queryAllVamms);

  let listVamms: any[] = [];
  let listvammPrices: string[] = [];

  allVamms.vamm_list.forEach((vamm: any) => {
    listVamms.push(vamm);
  });

  const promiseSpotPrice = listVamms.map((item) =>
    querySpotPrice(sender, item)
  );
  (await Promise.all(promiseSpotPrice));
  return listvammPrices
}

