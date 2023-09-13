import {Uint128, Direction, Addr, Integer, AssetInfo, Boolean} from "./types";
export interface InstantiateMsg {
  eligible_collateral: string;
  fee_pool: string;
  initial_margin_ratio: Uint128;
  insurance_fund?: string | null;
  liquidation_fee: Uint128;
  maintenance_margin_ratio: Uint128;
  pauser: string;
  tp_sl_spread: Uint128;
}
export type ExecuteMsg = {
  update_config: {
    fee_pool?: string | null;
    initial_margin_ratio?: Uint128 | null;
    insurance_fund?: string | null;
    liquidation_fee?: Uint128 | null;
    maintenance_margin_ratio?: Uint128 | null;
    owner?: string | null;
    partial_liquidation_ratio?: Uint128 | null;
    tp_sl_spread?: Uint128 | null;
  };
} | {
  update_pauser: {
    pauser: string;
  };
} | {
  add_whitelist: {
    address: string;
  };
} | {
  remove_whitelist: {
    address: string;
  };
} | {
  open_position: {
    base_asset_limit: Uint128;
    leverage: Uint128;
    margin_amount: Uint128;
    side: Side;
    stop_loss?: Uint128 | null;
    take_profit: Uint128;
    vamm: string;
  };
} | {
  update_tp_sl: {
    position_id: number;
    stop_loss?: Uint128 | null;
    take_profit?: Uint128 | null;
    vamm: string;
  };
} | {
  close_position: {
    position_id: number;
    quote_asset_limit: Uint128;
    vamm: string;
  };
} | {
  trigger_tp_sl: {
    position_id: number;
    quote_asset_limit: Uint128;
    vamm: string;
  };
} | {
  liquidate: {
    position_id: number;
    quote_asset_limit: Uint128;
    vamm: string;
  };
} | {
  pay_funding: {
    vamm: string;
  };
} | {
  deposit_margin: {
    amount: Uint128;
    position_id: number;
    vamm: string;
  };
} | {
  withdraw_margin: {
    amount: Uint128;
    position_id: number;
    vamm: string;
  };
} | {
  set_pause: {
    pause: boolean;
  };
};
export type Side = "buy" | "sell";
export type QueryMsg = {
  config: {};
} | {
  state: {};
} | {
  get_pauser: {};
} | {
  is_whitelisted: {
    address: string;
  };
} | {
  get_whitelist: {};
} | {
  position: {
    position_id: number;
    vamm: string;
  };
} | {
  all_positions: {
    limit?: number | null;
    order_by?: number | null;
    start_after?: number | null;
    trader: string;
  };
} | {
  positions: {
    filter: PositionFilter;
    limit?: number | null;
    order_by?: number | null;
    side?: Side | null;
    start_after?: number | null;
    vamm: string;
  };
} | {
  tick: {
    entry_price: Uint128;
    side: Side;
    vamm: string;
  };
} | {
  ticks: {
    limit?: number | null;
    order_by?: number | null;
    side: Side;
    start_after?: Uint128 | null;
    vamm: string;
  };
} | {
  unrealized_pnl: {
    calc_option: PnlCalcOption;
    position_id: number;
    vamm: string;
  };
} | {
  cumulative_premium_fraction: {
    vamm: string;
  };
} | {
  margin_ratio: {
    position_id: number;
    vamm: string;
  };
} | {
  margin_ratio_by_calc_option: {
    calc_option: PnlCalcOption;
    position_id: number;
    vamm: string;
  };
} | {
  free_collateral: {
    position_id: number;
    vamm: string;
  };
} | {
  balance_with_funding_payment: {
    position_id: number;
  };
} | {
  position_with_funding_payment: {
    position_id: number;
    vamm: string;
  };
} | {
  last_position_id: {};
};
export type PositionFilter = "none" | {
  trader: string;
} | {
  price: Uint128;
};
export type PnlCalcOption = "spot_price" | "twap" | "oracle";
export interface MigrateMsg {}
export type ArrayOfPosition = Position[];
export interface Position {
  block_time: number;
  direction: Direction;
  entry_price: Uint128;
  last_updated_premium_fraction: Integer;
  margin: Uint128;
  notional: Uint128;
  pair: string;
  position_id: number;
  side: Side;
  size: Integer;
  stop_loss?: Uint128 | null;
  take_profit: Uint128;
  trader: Addr;
  vamm: Addr;
}
export interface ConfigResponse {
  decimals: Uint128;
  eligible_collateral: AssetInfo;
  fee_pool: Addr;
  initial_margin_ratio: Uint128;
  insurance_fund?: Addr | null;
  liquidation_fee: Uint128;
  maintenance_margin_ratio: Uint128;
  owner: Addr;
  partial_liquidation_ratio: Uint128;
  tp_sl_spread: Uint128;
}
export interface PauserResponse {
  pauser: Addr;
}
export interface HooksResponse {
  hooks: string[];
}
export interface LastPositionIdResponse {
  last_order_id: number;
}
export interface StateResponse {
  bad_debt: Uint128;
  open_interest_notional: Uint128;
}
export interface TickResponse {
  entry_price: Uint128;
  total_positions: number;
}
export interface TicksResponse {
  ticks: TickResponse[];
}
export interface PositionUnrealizedPnlResponse {
  position_notional: Uint128;
  unrealized_pnl: Integer;
}