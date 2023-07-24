import {Uint128, Direction, Addr, Boolean, Integer} from "./types";
export interface InstantiateMsg {
  base_asset: string;
  base_asset_reserve: Uint128;
  decimals: number;
  fluctuation_limit_ratio: Uint128;
  funding_period: number;
  insurance_fund?: string | null;
  margin_engine?: string | null;
  pricefeed: string;
  quote_asset: string;
  quote_asset_reserve: Uint128;
  spread_ratio: Uint128;
  toll_ratio: Uint128;
}
export type ExecuteMsg = {
  update_config: {
    base_asset_holding_cap?: Uint128 | null;
    fluctuation_limit_ratio?: Uint128 | null;
    insurance_fund?: string | null;
    margin_engine?: string | null;
    open_interest_notional_cap?: Uint128 | null;
    pricefeed?: string | null;
    spot_price_twap_interval?: number | null;
    spread_ratio?: Uint128 | null;
    toll_ratio?: Uint128 | null;
  };
} | {
  update_owner: {
    owner: string;
  };
} | {
  swap_input: {
    base_asset_limit: Uint128;
    can_go_over_fluctuation: boolean;
    direction: Direction;
    position_id: number;
    quote_asset_amount: Uint128;
  };
} | {
  swap_output: {
    base_asset_amount: Uint128;
    direction: Direction;
    position_id: number;
    quote_asset_limit: Uint128;
  };
} | {
  settle_funding: {};
} | {
  set_open: {
    open: boolean;
  };
};
export type QueryMsg = {
  config: {};
} | {
  state: {};
} | {
  get_owner: {};
} | {
  input_price: {
    amount: Uint128;
    direction: Direction;
  };
} | {
  output_price: {
    amount: Uint128;
    direction: Direction;
  };
} | {
  input_amount: {
    amount: Uint128;
    direction: Direction;
  };
} | {
  output_amount: {
    amount: Uint128;
    direction: Direction;
  };
} | {
  input_twap: {
    amount: Uint128;
    direction: Direction;
  };
} | {
  output_twap: {
    amount: Uint128;
    direction: Direction;
  };
} | {
  spot_price: {};
} | {
  twap_price: {
    interval: number;
  };
} | {
  underlying_price: {};
} | {
  underlying_twap_price: {
    interval: number;
  };
} | {
  calc_fee: {
    quote_asset_amount: Uint128;
  };
} | {
  is_over_spread_limit: {};
} | {
  is_over_fluctuation_limit: {
    base_asset_amount: Uint128;
    direction: Direction;
  };
};
export interface MigrateMsg {}
export interface CalcFeeResponse {
  spread_fee: Uint128;
  toll_fee: Uint128;
}
export interface ConfigResponse {
  base_asset: string;
  base_asset_holding_cap: Uint128;
  decimals: Uint128;
  fluctuation_limit_ratio: Uint128;
  funding_period: number;
  insurance_fund: Addr;
  margin_engine: Addr;
  open_interest_notional_cap: Uint128;
  pricefeed: Addr;
  quote_asset: string;
  spot_price_twap_interval: number;
  spread_ratio: Uint128;
  toll_ratio: Uint128;
}
export interface OwnerResponse {
  owner: Addr;
}
export interface StateResponse {
  base_asset_reserve: Uint128;
  funding_rate: Integer;
  next_funding_time: number;
  open: boolean;
  quote_asset_reserve: Uint128;
  total_position_size: Integer;
}