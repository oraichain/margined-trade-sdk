export type Uint128 = string;
export type Side = "buy" | "sell";
export type PnlCalcOption = "spot_price" | "twap" | "oracle";
export type Direction = "add_to_amm" | "remove_from_amm";
export type Addr = string;
export type ArrayOfPosition = Position[];
export interface Position {
  block_number: number;
  direction: Direction;
  last_updated_premium_fraction: Integer;
  margin: Uint128;
  notional: Uint128;
  size: Integer;
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