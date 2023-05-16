import {Uint128, Addr, AssetInfo} from "./types";
export interface InstantiateMsg {}
export type ExecuteMsg = {
  update_owner: {
    owner: string;
  };
} | {
  add_token: {
    token: string;
  };
} | {
  remove_token: {
    token: string;
  };
} | {
  send_token: {
    amount: Uint128;
    recipient: string;
    token: string;
  };
};
export type QueryMsg = {
  config: {};
} | {
  get_owner: {};
} | {
  is_token: {
    token: string;
  };
} | {
  get_token_length: {};
} | {
  get_token_list: {
    limit?: number | null;
  };
};
export interface MigrateMsg {}
export interface ConfigResponse {}
export interface OwnerResponse {
  owner: Addr;
}
export interface TokenLengthResponse {
  length: number;
}
export interface AllTokenResponse {
  token_list: AssetInfo[];
}
export interface TokenResponse {
  is_token: boolean;
}