export type Uint128 = string;
export type Side = "buy" | "sell";
export type PositionFilter = "none" | {
  trader: string;
} | {
  price: Uint128;
};
export type PnlCalcOption = "spot_price" | "twap" | "oracle";
export type Direction = "add_to_amm" | "remove_from_amm";
export type Addr = string;
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
export interface Integer {
  negative: boolean;
  value: Uint128;
}
export type AssetInfo = {
  token: {
    contract_addr: Addr;
  };
} | {
  native_token: {
    denom: string;
  };
};
export type Boolean = boolean;
export { CosmWasmClient, SigningCosmWasmClient, ExecuteResult } from "@cosmjs/cosmwasm-stargate";