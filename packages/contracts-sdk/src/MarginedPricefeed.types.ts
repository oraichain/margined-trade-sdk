import {Uint128, Addr} from "./types";
export interface InstantiateMsg {
  oracle_hub_contract: string;
}
export type ExecuteMsg = {
  append_price: {
    key: string;
    price: Uint128;
    timestamp: number;
  };
} | {
  append_multiple_price: {
    key: string;
    prices: Uint128[];
    timestamps: number[];
  };
} | {
  update_owner: {
    owner: string;
  };
};
export type QueryMsg = {
  config: {};
} | {
  get_owner: {};
} | {
  get_price: {
    key: string;
  };
} | {
  get_previous_price: {
    key: string;
    num_round_back: number;
  };
} | {
  get_twap_price: {
    interval: number;
    key: string;
  };
};
export interface MigrateMsg {}
export interface ConfigResponse {}
export interface OwnerResponse {
  owner: Addr;
}