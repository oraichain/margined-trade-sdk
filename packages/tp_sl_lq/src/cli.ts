import dotenv from "dotenv";
import { matchingPosition } from "./index";
import { decrypt, delay, setupWallet } from "@oraichain/oraimargin-common";
dotenv.config();

(async () => {
  const engine_contractAddr = process.env.ENGINE_CONTRACT;
  const insurance_contractAddr = process.env.INSURANCE_FUND_CONTRACT;
  const sender = await setupWallet(
    decrypt(
      process.env.MNEMONIC_PASS,
      process.env.MNEMONIC_ENCRYPTED
    )
  );
  while (true) {
    try {
      await matchingPosition(
        sender,
        engine_contractAddr,
        insurance_contractAddr,
        "orai"
      );
    } catch (error) {
      console.error(error);
    }
    await delay(500);
  }
})();
