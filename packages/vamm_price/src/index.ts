import WebSocket from 'ws';

import { UserWallet } from "./helpers";

import {
  MarginedInsuranceFundTypes,
  MarginedVammTypes,
  Addr
} from '@oraichain/oraimargin-contracts-sdk';

const wss = new WebSocket.Server({ port: 1234 });

const querySpotPrice = async (
  sender: UserWallet,
  vamm: Addr,
) => {
  const query_config: MarginedVammTypes.QueryMsg = {
    config: {},
  };
  const vamm_config = await sender.client.queryContractSmart(vamm, query_config);

  const query_spot_price: MarginedVammTypes.QueryMsg = {
    spot_price: {},
  };
  const spot_price = Number(await sender.client.queryContractSmart(vamm, query_spot_price));
  console.log({ spot_price });
  
  wss.clients.forEach(ws => {
    ws.send(JSON.stringify({ base_asset: vamm_config.base_asset, quote_asset: vamm_config.quote_asset, spot_price }))
  })
};

export async function queryAllVammSpotPrice(
  sender: UserWallet,
  insurance_contractAddr: string
): Promise<void> {
  const allVamm: MarginedInsuranceFundTypes.QueryMsg = {
    get_all_vamm: {},
  };
  const query_vamms = await sender.client.queryContractSmart(insurance_contractAddr, allVamm);

  let execute_vamms: any[] = [];

  query_vamms.vamm_list.forEach((vamm: any) => {
    execute_vamms.push(vamm);
  });

  const promiseSpotPrice = execute_vamms.map((item) =>
    querySpotPrice(sender, item)
  );
  (await Promise.all(promiseSpotPrice)).filter(Boolean);
}

