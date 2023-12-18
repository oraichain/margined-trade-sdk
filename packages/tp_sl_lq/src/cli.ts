import dotenv from "dotenv";
import { EngineHandler, executeEngine, fetchSchedule } from "./index";
import {
  UserWallet,
  decrypt,
  delay,
  setupWallet,
} from "@oraichain/oraitrading-common";
import { WebhookClient, time, userMention } from "discord.js";
import cors from "cors";
import express from "express";
import { ExecuteInstruction } from "@cosmjs/cosmwasm-stargate";

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
        gasPrices: "0.001",
      }
    );
    return sender;
  } catch (error: any) {
    console.log({ error: error.message });
    return "Error: " + error.message;
  }
}

async function handleExecuteEngineCase(
  sender: UserWallet,
  engineHandler,
  executeInstruction: ExecuteInstruction[],
  webhookClient,
  mentionUserIds,
  event: "PayFunding" | "Liquidate" | "Take profit | Stop loss"
) {
  const date = new Date();

  if (executeInstruction.length > 0) {
    console.dir(executeInstruction, { depth: 4 });
    try {
      const res = await engineHandler.executeMultiple(executeInstruction);
      if (res) {
        console.log(`${event} - txHash:`, res.transactionHash);
        await webhookClient.send(
          `:receipt: BOT: ${sender.address} - ${event} - txHash: ${
            res.transactionHash
          } at ${time(date)}`
        );
      }
    } catch (error) {
      console.log(`error in processing triggering ${event}: `, { error });
      console.log("Send discord noti: ", error.message);
      await webhookClient.send(
        `:red_circle: BOT: ${sender.address} - err ${
          error.message
        } [${event}] at ${time(date)} ${mentionUserIds}`
      );
    }
  }
}

async function handleExecuteEngine(
  sender: UserWallet,
  engine: string,
  insuranceFund: string,
  webhookClient
) {
  const discordUserIds: string[] =
    process.env.DISCORD_USERS_IDS?.split(",") || [];

  const date = new Date();
  let mentionUserIds: string = "";
  for (const userId of discordUserIds) {
    mentionUserIds =
      " " + mentionUserIds + userMention(userId.replace(/[']/g, "")) + " ";
  }

  const engineHandler = new EngineHandler(sender, engine, insuranceFund);
  try {
    const [tpslMsg, liquidateMsg, payFundingMsg] = await executeEngine(
      engineHandler
    );

    handleExecuteEngineCase(
      sender,
      engineHandler,
      tpslMsg,
      webhookClient,
      mentionUserIds,
      "Take profit | Stop loss"
    );

    handleExecuteEngineCase(
      sender,
      engineHandler,
      liquidateMsg,
      webhookClient,
      mentionUserIds,
      "Liquidate"
    );

    handleExecuteEngineCase(
      sender,
      engineHandler,
      payFundingMsg,
      webhookClient,
      mentionUserIds,
      "PayFunding"
    );
  } catch (error) {
    console.log("error in processing triggering TpSl: ", { error });
    console.log("Send discord noti: ", error.message);
    await webhookClient.send(
      `:red_circle: BOT: ${sender.address} - err ${error.message} at ${time(
        date
      )} ${mentionUserIds}`
    );
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
      await handleExecuteEngine(
        sender,
        engineContract,
        insuranceFundContract,
        webhookClient
      );
    } catch (error) {
      console.log({ error });
    }
    await delay(3000);
  }
})();
