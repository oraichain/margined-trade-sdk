import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
export type UserWallet = { address: string; client: SigningCosmWasmClient };

export const delay = (milliseconds: number) => {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
};
