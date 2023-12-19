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

async function handleExecuteEngine(
  sender: UserWallet,
  engine: string,
  insuranceFund: string
): Promise<{ result: string; error: string }> {
  const date = new Date();
  let result = "";
  let error = "";

  const engineHandler = new EngineHandler(sender, engine, insuranceFund);
  try {
    const [tpslMsg, liquidateMsg, payFundingMsg] = await executeEngine(
      engineHandler
    );

    // try triggering tp sl
    try {
      if (tpslMsg.length > 0) {
        console.dir(tpslMsg, { depth: 4 });
        const res = await engineHandler.executeMultiple(tpslMsg);
        if (res !== undefined) {
          console.log("take profit | stop loss - txHash:", res.transactionHash);
          result =
            result +
            `:receipt: BOT: ${sender.address} - take profit | stop loss - txHash: ${res.transactionHash}` +
            ` at ${time(date)}`;
        }
      }
    } catch (err) {
      console.log("Send discord noti: ", err.message);
      console.log("error in processing triggering TpSl: ", { err });
      error =
        err +
        `:red_circle: BOT: ${sender.address} - err ` +
        err.message +
        ` at ${time(date)}`;
    }

    // try liquidate
    try {
      if (liquidateMsg.length > 0) {
        console.dir(liquidateMsg, { depth: 4 });
        try {
          const res = await engineHandler.executeMultiple(liquidateMsg);
          if (res !== undefined) {
            console.log("liquidate - txHash:", res.transactionHash);
            result =
              result +
              `:receipt: BOT: ${sender.address} - liquidate - txHash: ${res.transactionHash}` +
              ` at ${time(date)}`;
          }
        } catch (err) {
          for (let msg of liquidateMsg) {
            try {
              const res = await engineHandler.executeMultiple([msg]);
              if (res !== undefined) {
                console.log("liquidate - txHash:", res.transactionHash);
                result =
                  result +
                  `:receipt: BOT: ${sender.address} - liquidate - txHash: ${res.transactionHash}` +
                  ` at ${time(date)}`;
              }
            } catch (err) {
              console.log("Send discord noti: ", err.message);
              console.log("error in processing liquidate: ", {
                err,
              });
              error =
                err +
                `:red_circle: BOT: ${sender.address} - err ` +
                err.message +
                ` at ${time(date)}`;
            }
          }
        }
      }
    } catch (err) {
      console.log("error in processing liquidate: ", {
        err,
      });
    }

    // try pay funding
    try {
      if (payFundingMsg.length > 0) {
        console.dir(payFundingMsg, { depth: 4 });
        const res = await engineHandler.executeMultiple(payFundingMsg);
        if (res !== undefined) {
          console.log("payfunding - txHash:", res.transactionHash);
          result =
            result +
            `:receipt: BOT: ${sender.address} - payfunding - txHash: ${res.transactionHash}` +
            ` at ${time(date)}`;
        }
      }
    } catch (err) {
      console.log("error in processing pay funding: ", { err });
      console.log("Send discord noti: ", err.message);
      error =
        error +
        `:red_circle: BOT: ${sender.address} - err ` +
        err.message +
        ` at ${time(date)}`;
    }
    return { result, error };
  } catch (err) {
    console.log("error in processing triggering TpSl: ", { err });
    console.log("Send discord noti: ", err.message);
    error =
      error +
      `:red_circle: BOT: ${sender.address} - err ` +
      err.message +
      ` at ${time(date)}`;
    return {
      result,
      error,
    };
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
      const { result, error } = await handleExecuteEngine(
        sender,
        engineContract,
        insuranceFundContract
      );
      if (result && result != "") {
        await webhookClient.send(result);
      }
      if (error && error != "") {
        await webhookClient.send(result + mentionUserIds);
      }
    } catch (error) {
      console.log({ error });
    }
    await delay(3000);
  }
})();
