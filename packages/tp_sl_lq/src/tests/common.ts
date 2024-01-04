import * as oraidexArtifacts from '@oraichain/oraidex-contracts-build';
import { deployContract } from '@oraichain/oraimargin-contracts-build';
import { SimulateCosmWasmClient } from '@oraichain/cw-simulate';
import { Cw20Coin } from '@oraichain/common-contracts-sdk';
import { OraiswapTokenClient } from '@oraichain/oraidex-contracts-sdk';
import { MarginedEngineClient, MarginedFeePoolClient, MarginedInsuranceFundClient, MarginedPricefeedClient, MarginedVammClient } from '@oraichain/oraimargin-contracts-sdk';

export const TOKEN1 = 'orai10ldgzued6zjp0mkqwsv2mux3ml50l97c74x8sg';
export const TOKEN2 = 'orai1lus0f0rhx8s03gdllx2n6vhkmf0536dv57wfge';
export const TOKEN3 = 'orai12hzjxfh77wl572gdzct2fxv2arxcwh6gykc7qh';
export const TOKEN4 = 'orai15un8msx3n5zf9ahlxmfeqd2kwa5wm0nrpxer304m9nd5q6qq0g6sku5pdd';
export const senderAddress = 'orai1g4h64yjt0fvzv5v2j8tyfnpe5kmnetejvfgs7g';
export const bobAddress = 'orai18cgmaec32hgmd8ls8w44hjn25qzjwhannd9kpj';
export const aliceAddress = 'orai1hz4kkphvt0smw4wd9uusuxjwkp604u7m4akyzv';
export const carolAddress = 'orai12zyu8w93h0q2lcnt50g3fn0w3yqnhy4fvawaqz';

export const deployToken = async (
  client: SimulateCosmWasmClient,
  { symbol, name, decimals = 6, initial_balances = [{ address: senderAddress, amount: '1000000000' }] }: { symbol: string; name: string; decimals?: number; initial_balances?: Cw20Coin[] }
): Promise<OraiswapTokenClient> => {
  return new OraiswapTokenClient(
    client,
    senderAddress,
    await oraidexArtifacts
      .deployContract(
        client,
        senderAddress,
        {
          decimals,
          symbol,
          name,
          mint: { minter: senderAddress },
          initial_balances
        },
        'oraiswap token',
        'oraiswap_token'
      )
      .then((res) => res.contractAddress)
  );
};

export const deployEngine = async (
  client: SimulateCosmWasmClient,
  {
    insurance_fund,
    fee_pool,
    token,
    initial_margin_ratio = '50000',
    maintenance_margin_ratio = '50000',
    tp_sl_spread = '50000',
    liquidation_fee = '100'
  }: {
    insurance_fund?: string;
    fee_pool: string;
    token: string;
    initial_margin_ratio?: string;
    maintenance_margin_ratio?: string;
    tp_sl_spread?: string;
    liquidation_fee?: string;
  }
): Promise<MarginedEngineClient> => {
  return new MarginedEngineClient(
    client,
    senderAddress,
    await deployContract(client, senderAddress, 'margined_engine', {
      pauser: senderAddress,
      insurance_fund,
      fee_pool,
      eligible_collateral: token,
      initial_margin_ratio, // 0.05
      maintenance_margin_ratio, // 0.05
      tp_sl_spread,
      liquidation_fee // 0.05
    }).then((res) => res.contractAddress)
  );
};

export const deployFeePool = async (client: SimulateCosmWasmClient): Promise<MarginedFeePoolClient> => {
  return new MarginedFeePoolClient(client, senderAddress, await deployContract(client, senderAddress, 'margined_fee_pool').then((res) => res.contractAddress));
};

export const deployPricefeed = async (client: SimulateCosmWasmClient): Promise<MarginedPricefeedClient> => {
  return new MarginedPricefeedClient(
    client,
    senderAddress,
    await deployContract(client, senderAddress, 'margined_pricefeed', {
      oracle_hub_contract: 'oracle_hub0000'
    }).then((res) => res.contractAddress)
  );
};

export const deployInsuranceFund = async (client: SimulateCosmWasmClient, { engine }: { engine: string }): Promise<MarginedInsuranceFundClient> => {
  return new MarginedInsuranceFundClient(
    client,
    senderAddress,
    await deployContract(client, senderAddress, 'margined_insurance_fund', {
      engine
    }).then((res) => res.contractAddress)
  );
};

export const toDecimals = (num: number, decimals: number = 9): string => {
  return (num * 10 ** decimals).toFixed();
};

export const deployVamm = async (
  client: SimulateCosmWasmClient,
  {
    pricefeed,
    margin_engine,
    insurance_fund,
    decimals = 6,
    funding_period = 3_600,
    fluctuation_limit_ratio = toDecimals(0.01, decimals),
    base_asset_reserve = toDecimals(10, decimals),
    quote_asset_reserve = toDecimals(100, decimals),
    toll_ratio = toDecimals(0.01, decimals),
    spread_ratio = toDecimals(0.01, decimals),
    initial_margin_ratio = toDecimals(0.05, decimals),
  }: {
    pricefeed: string;
    margin_engine?: string;
    funding_period?: number;
    insurance_fund?: string;
    decimals?: number;
    fluctuation_limit_ratio?: string;
    quote_asset_reserve?: string;
    base_asset_reserve?: string;
    toll_ratio?: string;
    spread_ratio?: string;
    initial_margin_ratio?: string;
  }
): Promise<MarginedVammClient> => {
  return new MarginedVammClient(
    client,
    senderAddress,
    await deployContract(client, senderAddress, 'margined_vamm', {
      decimals,
      quote_asset: 'USD',
      base_asset: 'ETH',
      quote_asset_reserve,
      base_asset_reserve,
      funding_period,
      toll_ratio,
      spread_ratio,
      fluctuation_limit_ratio,
      pricefeed,
      margin_engine,
      insurance_fund,
      initial_margin_ratio
    }).then((res) => res.contractAddress)
  );
};
