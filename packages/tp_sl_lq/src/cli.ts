import dotenv from "dotenv";
import { executeEngine } from "./index";
import { decrypt, delay, setupWallet } from "@oraichain/oraimargin-common";
import { WebhookClient, time, blockQuote, userMention } from "discord.js";

dotenv.config();

const minimumOraiBalance = 1000000; // 1 ORAI;

(async () => {
  const webhookUrl = process.env.DISCORD_WEBHOOK ?? "";
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
      const res = await executeEngine(sender, engine, insurance);
      if (res !== undefined) {
        console.log(
          "take profit | stop loss | liquidate | payfunding - txHash:",
          res.transactionHash
        );
        await webhookClient.send(
          `:receipt: BOT: ${sender.address} - take profit | stop loss | liquidate | payfunding - txHash: ` +
            `https://scan.orai.io/txs/${res.transactionHash}`.toString() +
            ` at ${time(date)}`
        );
      }
    } catch (error) {
      console.log(
        "error in processing triggering TpSl, liquidate & pay funding: ",
        { error }
      );
      await webhookClient.send(
        `:red_circle: BOT: ${sender.address} - err ` +
          error.message +
          ` at ${time(date)}` +
          mentionUserIds
      );
    }
    await delay(
      process.env.BOT_INTERVAL ? parseInt(process.env.BOT_INTERVAL) : 3000
    );
  }
})();
