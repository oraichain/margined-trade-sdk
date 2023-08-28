import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { stringToPath } from "@cosmjs/crypto";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { GasPrice } from "@cosmjs/stargate";
import dotenv from 'dotenv';
import { delay, matchingPosition } from "./index";
dotenv.config();

const mnemonicMinLength = 12; // 12 words

(async () => {
  const prefix = "orai";
  const mnemonic = process.env["MNEMONIC"];
  const mnemonicWords = mnemonic.split(" ");
  const engine_contractAddr = process.env.ENGINE_CONTRACT;
  const vamm_contractAddr = process.env.VAMM_CONTRACT;
  const insurance_contractAddr = process.env.INSURANCE_FUND_CONTRACT;
  if (
    !mnemonic ||
    (mnemonicWords.length != mnemonicMinLength &&
      mnemonicWords.length != mnemonicMinLength * 2)
  ) {
    throw new Error(
      `Must set MNEMONIC to a 12 or word phrase. Has: ${mnemonic.length}`
    );
  }
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    hdPaths: [stringToPath(process.env.HD_PATH || "m/44'/118'/0'/0/0")],
    prefix,
  });
  const [firstAccount] = await wallet.getAccounts();
  const senderAddress = firstAccount.address;
  const client = await SigningCosmWasmClient.connectWithSigner(
    process.env.RPC_URL!,
    wallet,
    {
      gasPrice: GasPrice.fromString("0.002orai"),
    }
  );
  
  let processInd = 0;
  while (processInd < 10) {
    try {
      await matchingPosition(client, senderAddress, engine_contractAddr, vamm_contractAddr, insurance_contractAddr, 30, "orai");
    } catch (error) {
      console.error(error);
    }

    processInd ++;
    await delay(2000);
  }
})();
