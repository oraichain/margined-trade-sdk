import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';

export async function sendToken(
  client: SigningCosmWasmClient,
  senderAddress: string,
  recipientAddress: string,
  amount: string
) {
  const fee = {
    gas: '30000000',
    amount: [{ denom: 'orai', amount: '150000' }]
  };

  return await client.sendTokens(senderAddress, recipientAddress, [{ denom: 'orai', amount: amount }], fee);
}

export type UserWallet = { address: string; client: SigningCosmWasmClient };

export const getOraclePrice = async (token: string): Promise<number> => {
  const res = await fetch(`https://api.orchai.io/lending/mainnet/token/${token}`).then((res) => res.json());
  return res.current_price;
};

export const delay = (milliseconds: number) => {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
};
