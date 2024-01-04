import dotenv from "dotenv";
import { EngineHandler, executeEngine, fetchSchedule } from "./index";
import {
  UserWallet,
  decrypt,
  delay,
  setupWallet,
} from "@oraichain/oraitrading-common";
import { WebhookClient, time, userMention } from "discord.js";
dotenv.config();
const minimumOraiBalance = 1000000; // 1 ORAI;

async function getSender(rpcUrl: string): Promise<UserWallet | string> {
  try {
    const sender = await setupWallet(
      process.env.MNEMONIC ??
        decrypt(process.env.MNEMONIC_PASS, process.env.MNEMONIC_ENCRYPTED),
      {
        hdPath: process.env.HD_PATH ?? "m/44'/118'/0'/0/0",
        rpcUrl,
        prefix: "orai",
        gasPrices: "0.001",
      }
    );
    return sender;
  } catch (error: any) {
    console.log({ error: error.message });
    return "Error: " + error.message;
  }
}

(async () => {
  const webhookUrl = process.env.DISCORD_WEBHOOK ?? "";
  const rpcUrl = process.env.RPC_URL ?? "https://rpc.orai.io";

  if (webhookUrl === "") {
    console.log("Discord webhook is not set!");
  }

  const webhookClient = new WebhookClient({
    url: webhookUrl,
  });

  const sender = await getSender(rpcUrl);
  if (typeof sender === "string") {
    throw new Error("Cannot get sender - err: " + sender);
  }

  const { amount } = await sender.client.getBalance(sender.address, "orai");
  console.log(`balance of ${sender.address} is ${amount}`);
  let date: Date = new Date();
  if (parseInt(amount) <= minimumOraiBalance) {
    await webhookClient.send(
      `:red_circle: STOP BOT: ${sender.address} ` +
        `Balance(${amount}) of ${sender.address} must be greater than 1 ORAI` +
        ` at ${time(date)}`
    );
    throw new Error(
      `Balance(${amount}) of ${sender.address} must be greater than 1 ORAI`
    );
  }
  const engineContract = process.env.ENGINE_CONTRACT;
  const insuranceFundContract = process.env.INSURANCE_FUND_CONTRACT;

  const engineHandler = new EngineHandler(
    sender,
    engineContract,
    insuranceFundContract
  );

  while (true) {
    try {
      const [tpslMsg, liquidateMsg, payFundingMsg] = await executeEngine(
        engineHandler
      );
      if (tpslMsg.length > 0) {
        await webhookClient.send(
          `:receipt: BOT: ${engineHandler.sender.address} - ${tpslMsg}`
        );
      }
      if (liquidateMsg.length > 0) {
        await webhookClient.send(
          `:receipt: BOT: ${engineHandler.sender.address} - ${liquidateMsg}`
        );
      }
      if (payFundingMsg.length > 0) {
        await webhookClient.send(
          `:receipt: BOT: ${engineHandler.sender.address} - ${payFundingMsg}`
        );
      }
    } catch (error) {
      console.log({ error });
    }
    await delay(3000);
  }
})();
