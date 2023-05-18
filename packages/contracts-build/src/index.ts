import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { MarginedEngineTypes, MarginedFeePoolTypes, MarginedInsuranceFundTypes, MarginedPricefeedTypes, MarginedVammTypes } from '@oraichain/oraimargin-contracts-sdk';
import { readFileSync } from 'fs';
import path from 'path';

export type ContractName = 'margined_vamm' | 'margined_fee_pool' | 'margined_pricefeed' | 'margined_insurance_fund' | 'margined_engine';
export type InstantiateMsg = MarginedEngineTypes.InstantiateMsg | MarginedFeePoolTypes.InstantiateMsg | MarginedPricefeedTypes.InstantiateMsg | MarginedInsuranceFundTypes.InstantiateMsg | MarginedVammTypes.InstantiateMsg;
export type MigrateMsg = MarginedInsuranceFundTypes.MigrateMsg;

const contractDir = path.join(path.dirname(module.filename), '..', 'data');

export const getContractDir = (name: ContractName = 'margined_engine') => {
  return path.join(contractDir, name + '.wasm');
};

export const deployContract = async (client: SigningCosmWasmClient, senderAddress: string, msg: InstantiateMsg, label: string, contractName?: ContractName) => {
  // upload and instantiate the contract
  const wasmBytecode = readFileSync(getContractDir(contractName));
  const uploadRes = await client.upload(senderAddress, wasmBytecode, 'auto');
  const initRes = await client.instantiate(senderAddress, uploadRes.codeId, msg, label, 'auto');
  return { ...uploadRes, ...initRes };
};

export const migrateContract = async (client: SigningCosmWasmClient, senderAddress: string, contractAddress: string, msg: MigrateMsg, contractName?: ContractName) => {
  // upload and instantiate the contract
  const wasmBytecode = readFileSync(getContractDir(contractName));
  const uploadRes = await client.upload(senderAddress, wasmBytecode, 'auto');
  const migrateRes = await client.migrate(senderAddress, contractAddress, uploadRes.codeId, msg, 'auto');
  return { ...uploadRes, ...migrateRes };
};
