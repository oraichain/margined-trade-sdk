import dotenv from "dotenv";
import { executeEngine } from "./index";
import { UserWallet, decrypt, setupWallet } from "@oraichain/oraimargin-common";
import { WebhookClient, time, userMention } from "discord.js";
// import { Tendermint37Client, WebsocketClient } from "@cosmjs/tendermint-rpc";

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
  engineAddr?: string,
  insuranceAddr?: string
): Promise<string> {
  const date = new Date();
  try {
    const res = await executeEngine(
      sender,
      engineAddr ?? process.env.ENGINE_CONTRACT,
      insuranceAddr ?? process.env.INSURANCE_FUND_CONTRACT
    );
    if (res !== undefined) {
      console.log(
        "take profit | stop loss | liquidate | payfunding - txHash:",
        res.transactionHash
      );
      return (
        `:receipt: BOT: ${sender.address} - take profit | stop loss | liquidate | payfunding - txHash: ` +
        `https://scan.orai.io/txs/${res.transactionHash}`.toString() +
        ` at ${time(date)}`
      );
    }
    return "";
  } catch (error) {
    console.log(
      "error in processing triggering TpSl, liquidate & pay funding: ",
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
  console.log({ webhookUrl, discordUserIds });

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

  while (true) {
    try {
      const result = await handleExecuteEngine(sender);
      if (result) {
        if (result.includes("err"))
          await webhookClient.send(result + mentionUserIds);
        else await webhookClient.send(result);
      }
    } catch (error) {
      await webhookClient.send(JSON.stringify({ error }));
    }
  }
  // const websocket = new WebsocketClient(rpcUrl);
  // const client = await Tendermint37Client.create(websocket);
  // const stream = client.subscribeNewBlock();
  // stream.subscribe({
  //   next: async (event) => {
  //     console.log("height: ", event.header.height);
  //     try {
  //       const result = await handleExecuteEngine(sender);
  //       if (result) {
  //         if (result.includes("err"))
  //           await webhookClient.send(result + mentionUserIds);
  //         else await webhookClient.send(result);
  //       }
  //     } catch (error) {
  //       await webhookClient.send(JSON.stringify({ error }));
  //     }
  //   },
  //   error: async (error) => {
  //     console.log("error in subscribing to the websocket: ", error);
  //     await webhookClient.send(JSON.stringify({ error }));
  //   },
  //   complete: async () => {
  //     await webhookClient.send("Block subscription completed. Exiting ...");
  //   },
  // });
})();
