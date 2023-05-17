import {
  MarginedInsuranceFundTypes,
  MarginedEngineTypes,
  MarginedVammTypes,
  MarginedPricefeedTypes,
  MarginedFeePoolTypes
} from '@oraichain/oraimargin-contracts-sdk';

interface Config {
  insuranceFundInitMsg: MarginedInsuranceFundTypes.InstantiateMsg;
  feepoolInitMsg: MarginedFeePoolTypes.InstantiateMsg;
  engineInitMsg: MarginedEngineTypes.InstantiateMsg;
  priceFeedInitMsg: MarginedPricefeedTypes.InstantiateMsg;
  vammInitMsg: MarginedVammTypes.InstantiateMsg;
  cw20_tokens: { usdt: string };
}

export const mainnet: Config = {
  cw20_tokens: {
    usdt: ''
  },
  feepoolInitMsg: {},
  insuranceFundInitMsg: {
    engine: ''
  },
  priceFeedInitMsg: {
    oracle_hub_contract: ''
  },
  engineInitMsg: {
    pauser: '',
    insurance_fund: '',
    fee_pool: '',
    eligible_collateral: '',
    initial_margin_ratio: '50000',
    maintenance_margin_ratio: '50000',
    liquidation_fee: '50000'
  },
  vammInitMsg: {
    decimals: 6,
    pricefeed: '',
    quote_asset: 'USDC',
    base_asset: 'ETH',
    quote_asset_reserve: '1200000000000',
    base_asset_reserve: '1000000000',
    funding_period: 3_600, // 1 hour in seconds
    toll_ratio: '0',
    spread_ratio: '0',
    fluctuation_limit_ratio: '0'
  }
};
