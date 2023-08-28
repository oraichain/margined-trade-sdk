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
