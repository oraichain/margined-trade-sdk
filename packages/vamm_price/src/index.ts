import { UserWallet } from "@oraichain/oraimargin-common";
import {
  Addr,
  MarginedVammQueryClient,
  MarginedInsuranceFundQueryClient,
} from "@oraichain/oraimargin-contracts-sdk";

const querySpotPrice = async (
  sender: UserWallet,
  vamm: Addr
): Promise<string> => {
  const vammClient = new MarginedVammQueryClient(sender.client, vamm);
  const vammConfig = await vammClient.config();
  const spotPrice = Number(await vammClient.spotPrice());
  const pairPrice = JSON.stringify({
    pair: `${vammConfig.base_asset}/${vammConfig.quote_asset}`,
    spot_price: spotPrice,
  });

  return pairPrice;
};

export async function queryAllVammSpotPrice(
  sender: UserWallet,
  insurance: Addr
): Promise<string[]> {
  const insuranceClient = new MarginedInsuranceFundQueryClient(
    sender.client,
    insurance
  );
  const allVamms = await insuranceClient.getAllVamm({});

  const promiseSpotPrice = allVamms.vamm_list.map((item) =>
    querySpotPrice(sender, item)
  );
  const listvammPrices = await Promise.all(promiseSpotPrice);
  return listvammPrices;
}
