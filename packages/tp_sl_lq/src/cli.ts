import dotenv from "dotenv";
import { executeEngine } from "./index";
import { decrypt, delay, setupWallet } from "@oraichain/oraimargin-common";
dotenv.config();

const minimumOraiBalance = 1000000; // 1 ORAI;

(async () => {
  const engine = process.env.ENGINE_CONTRACT;
  const insurance = process.env.INSURANCE_FUND_CONTRACT;
  const sender = await setupWallet(
    decrypt(process.env.MNEMONIC_PASS, process.env.MNEMONIC_ENCRYPTED),
    {
      hdPath: process.env.HD_PATH,
      rpcUrl: process.env.RPC_URL,
      prefix: process.env.PREFIX,
    }
  );

  const { amount } = await sender.client.getBalance(sender.address, "orai");
  console.log(`balance of ${sender.address} is ${amount}`);
  if (parseInt(amount) <= minimumOraiBalance) {
    throw new Error(
      `Balance(${amount}) of ${sender.address} must be greater than 1 ORAI`
    );
  }

  while (true) {
    // TODO: add send noti to discord
    try {
      const res = await executeEngine(sender, engine, insurance);
      console.log("take profit | stop loss | liquidate | payfunding- txHash:", res.transactionHash);
    } catch (error) {
      console.log(
        "error in processing triggering TpSl, liquidate & pay funding: ",
        { error }
      );
    }
    await delay(
      process.env.BOT_INTERVAL ? parseInt(process.env.BOT_INTERVAL) : 3000
    );
  }
})();
