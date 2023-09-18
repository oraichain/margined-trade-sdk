import {Uint128, Addr} from "./types";
export interface InstantiateMsg {
  engine: string;
}
export type ExecuteMsg = {
  update_owner: {
    owner: string;
  };
} | {
  add_vamm: {
    vamm: string;
  };
} | {
  remove_vamm: {
    vamm: string;
  };
} | {
  withdraw: {
    amount: Uint128;
    token: AssetInfo;
  };
} | {
  shutdown_vamms: {};
};
export type AssetInfo = {
  token: {
    contract_addr: Addr;
  };
} | {
  native_token: {
    denom: string;
  };
};
export type QueryMsg = {
  config: {};
} | {
  get_owner: {};
} | {
  is_vamm: {
    vamm: string;
  };
} | {
  get_all_vamm: {
    limit?: number | null;
  };
} | {
  get_all_vamm_status: {
    limit?: number | null;
  };
} | {
  get_vamm_status: {
    vamm: string;
  };
};
export interface MigrateMsg {}
export interface ConfigResponse {
  engine: Addr;
}
export interface AllVammResponse {
  vamm_list: Addr[];
}
export interface AllVammStatusResponse {
  vamm_list_status: [Addr, boolean][];
}
export interface OwnerResponse {
  owner: Addr;
}
export interface VammStatusResponse {
  vamm_status: boolean;
}
export interface VammResponse {
  is_vamm: boolean;
}