import {
  InstantiateResult,
  SigningCosmWasmClient,
  UploadResult,
} from "@cosmjs/cosmwasm-stargate";
import {
  MarginedEngineTypes,
  MarginedInsuranceFundTypes,
  MarginedPricefeedTypes,
  MarginedVammTypes,
} from "@oraichain/oraimargin-contracts-sdk";
import { readFileSync } from "fs";
import path from "path";

export type ContractName =
  | "margined_vamm"
  | "margined_fee_pool"
  | "margined_pricefeed"
  | "margined_insurance_fund"
  | "margined_engine";
export type InstantiateMsg =
  | MarginedEngineTypes.InstantiateMsg
  | MarginedPricefeedTypes.InstantiateMsg
  | MarginedInsuranceFundTypes.InstantiateMsg
  | MarginedVammTypes.InstantiateMsg;

const contractDir = path.join(path.dirname(module.filename), "..", "data");

export const getContractDir = (name: ContractName = "margined_engine") => {
  return path.join(contractDir, name + ".wasm");
};

export const deployContract = async (
  client: SigningCosmWasmClient,
  senderAddress: string,
  contractName?: ContractName,
  msg?: InstantiateMsg,
  label?: string
): Promise<UploadResult & InstantiateResult> => {
  // upload and instantiate the contract
  const wasmBytecode = readFileSync(getContractDir(contractName));
  const uploadRes = await client.upload(senderAddress, wasmBytecode, "auto");
  const initRes = await client.instantiate(
    senderAddress,
    uploadRes.codeId,
    msg ?? {},
    label ?? contractName,
    "auto"
  );
  return { ...uploadRes, ...initRes };
};
