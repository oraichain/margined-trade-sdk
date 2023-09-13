export type Uint128 = string;
export type Direction = "add_to_amm" | "remove_from_amm";
export type Addr = string;
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
export interface ConfigResponse {}
export interface OwnerResponse {
  owner: Addr;
}
export { CosmWasmClient, SigningCosmWasmClient, ExecuteResult } from "@cosmjs/cosmwasm-stargate";