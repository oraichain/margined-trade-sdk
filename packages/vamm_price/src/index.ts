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
  const allVamms = [
    "orai1hgc4tmvuj6zuagyjpjjdrgwzj6ncgclm0n6rn4vwjg3wdxxyq0fs9k3ps9",
    "orai1rujsndzwez98c9wg8vfp0fcjfeprddnlud5dweesd3j0qume9nzqvs0ykn",
  ];
  const promiseSpotPrice = allVamms.map((item) =>
    querySpotPrice(client, item)
  );
  const listvammPrices = await Promise.all(promiseSpotPrice);
  return listvammPrices;
}
