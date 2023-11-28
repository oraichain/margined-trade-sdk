import {
  Addr,
  MarginedVammQueryClient,
  MarginedInsuranceFundQueryClient,
} from "@oraichain/oraimargin-contracts-sdk";
import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';

const querySpotPrice = async (
  client: CosmWasmClient,
  vamm: Addr
): Promise<string> => {
  const vammClient = new MarginedVammQueryClient(client, vamm);
  const vammConfig = await vammClient.config();
  const spotPrice = Number(await vammClient.spotPrice());
  const pairPrice = JSON.stringify({
    pair: `${vammConfig.base_asset}/${vammConfig.quote_asset}`,
    spot_price: spotPrice,
  });
  return pairPrice;
};

export async function queryAllVammSpotPrice(
  client: CosmWasmClient,
  insurance: Addr
): Promise<string[]> {
  const insuranceClient = new MarginedInsuranceFundQueryClient(
    client,
    insurance
  );
  const allVamms = await insuranceClient.getAllVamm({});
  const promiseSpotPrice = allVamms.vamm_list.map((item) =>
    querySpotPrice(client, item)
  );
  const listvammPrices = await Promise.all(promiseSpotPrice);
  return listvammPrices;
}
