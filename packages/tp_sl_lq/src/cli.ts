import dotenv from "dotenv";
import { EngineHandler, executeEngine, fetchSchedule } from "./index";
import { UserWallet, decrypt, delay, setupWallet } from "@oraichain/oraitrading-common";
import { WebhookClient, time, userMention } from "discord.js";
import cors from 'cors';
import express from 'express';

dotenv.config();

const minimumOraiBalance = 1000000; // 1 ORAI;
const app = express();
app.use(cors());

const port = process.env.PORT || 30000;

app.listen(port, async () => {
  console.log(`[bot]: Perp bot is running at http://localhost:${port}`);
});

async function getSender(rpcUrl: string): Promise<UserWallet | string> {
  try {
    const sender = await setupWallet(
      process.env.MNEMONIC ??
        decrypt(process.env.MNEMONIC_PASS, process.env.MNEMONIC_ENCRYPTED),
      {
        hdPath: process.env.HD_PATH ?? "m/44'/118'/0'/0/0",
        rpcUrl,
        prefix: "orai",
        gasPrices: "0.001"
      }
    );
    return sender;
  } catch (error: any) {
    console.log({ error: error.message});
    return "Error: " + error.message;
  }
}

async function handleExecuteEngine(
  sender: UserWallet,
  engine: string,
  insuranceFund: string
): Promise<string> {
  const date = new Date();
  let result = "";
  const engineHandler = new EngineHandler(sender, engine, insuranceFund); 
  try {  
    const [tpslMsg, liquidateMsg, payFundingMsg] = await executeEngine(engineHandler);
    if (tpslMsg.length > 0) {
      console.dir(tpslMsg, { depth: 4 });
      const res = await engineHandler.executeMultiple(tpslMsg);
      if (res !== undefined) {
        console.log(
          "take profit | stop loss - txHash:",
          res.transactionHash
        );
        result = result + `:receipt: BOT: ${sender.address} - take profit | stop loss - txHash: ${res.transactionHash}` + ` at ${time(date)}`;
      }
    }

    if (liquidateMsg.length > 0) {
      console.dir(liquidateMsg, { depth: 4 });
      const res = await engineHandler.executeMultiple(liquidateMsg);
      if (res !== undefined) {
        console.log(
          "liquidate - txHash:",
          res.transactionHash
        );
        result = result + `:receipt: BOT: ${sender.address} - liquidate - txHash: ${res.transactionHash}` + ` at ${time(date)}`;
      }
    }

    if (payFundingMsg.length > 0) {
      console.dir(payFundingMsg, { depth: 4 });
      const res = await engineHandler.executeMultiple(payFundingMsg);
      if (res !== undefined) {
        console.log(
          "payfunding - txHash:",
          res.transactionHash
        );
        result = result + `:receipt: BOT: ${sender.address} - payfunding - txHash: ${res.transactionHash}` + ` at ${time(date)}`;
      }
    }
    return result;
  } catch (error) {
    console.log(
      "error in processing triggering TpSl: ",
      { error }
    );
    console.log("Send discord noti: ", error.message);
    return (
      `:red_circle: BOT: ${sender.address} - err ` +
      error.message +
      ` at ${time(date)}`
    );
  }
}

(async () => {
  const webhookUrl = process.env.DISCORD_WEBHOOK ?? "";
  const rpcUrl = process.env.RPC_URL ?? "https://rpc.orai.io";
  const discordUserIds: string[] =
    process.env.DISCORD_USERS_IDS?.split(",") || [];

  let mentionUserIds: string = "";
  for (const userId of discordUserIds) {
    mentionUserIds =
      " " + mentionUserIds + userMention(userId.replace(/[']/g, "")) + " ";
  }

  if (webhookUrl === "") {
    console.log("Discord webhook is not set!");
  }

  const webhookClient = new WebhookClient({
    url: webhookUrl,
  });

  const scheduleTask = new fetchSchedule();
  scheduleTask.executeJob();

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

  while (true) {
    try {
      const result = await handleExecuteEngine(sender, engineContract, insuranceFundContract);
      if (result) {
        if (result.includes("err"))
          await webhookClient.send(result + mentionUserIds);
        else await webhookClient.send(result);
      }
    } catch (error) {
      console.log({ error });
    }
    await delay(3000);
  }
})();
