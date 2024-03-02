import dotenv from "dotenv";
import { queryAllVammSpotPrice } from "./index";
import { delay } from "@oraichain/oraitrading-common";
import WebSocket from "ws";
import { WebhookClient, time } from "discord.js";
import { CosmWasmClient } from "@cosmjs/cosmwasm-stargate";

dotenv.config();

const wss = new WebSocket.Server({
  port: process.env.WS_PORT ? Number(process.env.WS_PORT) : 3001,
});

const sendPrice = async (
  timeStamp: number,
  prices: string[],
  webhookClient: WebhookClient
) => {
  for (const spotPrice of prices) {
    wss.clients.forEach((ws) => {
      ws.send(
        JSON.stringify({
          event: "market_price",
          pair_price: spotPrice,
          time: timeStamp,
        })
      );
    });

    await webhookClient.send(`💵 ${spotPrice} ` + `at ${time(new Date())}`);
  }
};

(async () => {
  const webhookUrl = process.env.DISCORD_WEBHOOK ?? "";
  console.log({ webhookUrl });

  if (webhookUrl === "") {
    console.log("Discord webhook is not set!");
  }

  const webhookClient = new WebhookClient({
    url: webhookUrl,
  });

  const insurance = process.env.INSURANCE_FUND_CONTRACT;
  const sendTime = process.env.SEND_TIME ? Number(process.env.SEND_TIME) : 3600;
  console.log({ sendTime });
  const client = await CosmWasmClient.connect(
    process.env.RPC_URL ?? "https://rpc.orai.io/"
  );

  let prevPrices: string[] = [];
  let preTime: number = 0;
  let clientConnected: boolean = false;

  wss.on("connection", function () {
    console.log("client connected");
    clientConnected = true;
  });

  while (true) {
    try {
      let curTime = Math.floor(Date.now() / 1000);
      const alLPrices = await queryAllVammSpotPrice(client, insurance);
      console.log({ alLPrices });

      const differencePrices =
        prevPrices.length === 0
          ? alLPrices
          : alLPrices.filter((x) => !prevPrices.includes(x));
      prevPrices = alLPrices;

      if (differencePrices.length > 0) {
        console.log("SEND CHANGED PRICE");
        console.log({ differencePrices });
        sendPrice(curTime, differencePrices, webhookClient);
      }

      if (clientConnected) {
        console.log("CLIENT CONNECTED - SEND PRICES");
        clientConnected = false;
        sendPrice(curTime, alLPrices, webhookClient);
      }
      if (curTime - preTime >= sendTime) {
        console.log("SEND PRICES SEQUENTIALLY");
        preTime = curTime;
        sendPrice(curTime, alLPrices, webhookClient);
      }
    } catch (error) {
      console.error("Error updating oracle price: ", error);
    }
    await delay(
      process.env.BOT_INTERVAL ? parseInt(process.env.BOT_INTERVAL) : 6000
    );
  }
})();
