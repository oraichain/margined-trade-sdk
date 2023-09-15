import dotenv from "dotenv";
import { queryAllVammSpotPrice } from "./index";
import { decrypt, delay, setupWallet } from "@oraichain/oraimargin-common";
import WebSocket from "ws";
dotenv.config();

const wss = new WebSocket.Server({ port: 3001 });

const sendPrice = async (time: number, prices: string[]) => {
  for (const spotPrice of prices) {
    wss.clients.forEach((ws) => {
      ws.send(
        JSON.stringify({
          event: "market_price",
          pair_price: spotPrice,
          time,
        })
      );
    });
  }
};

(async () => {
  const insurance = process.env.INSURANCE_FUND_CONTRACT;
  const sendTime = process.env.SEND_TIME ? Number(process.env.SEND_TIME) : 3600;
  console.log({ sendTime });
  const sender = await setupWallet(
    decrypt(process.env.MNEMONIC_PASS, process.env.MNEMONIC_ENCRYPTED),
    {
      hdPath: process.env.HD_PATH,
      rpcUrl: process.env.RPC_URL,
      prefix: process.env.PREFIX,
    }
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
      const alLPrices = await queryAllVammSpotPrice(sender, insurance);
      console.log({ alLPrices });

      const differencePrices =
        prevPrices.length === 0
          ? alLPrices
          : alLPrices.filter((x) => !prevPrices.includes(x));
      prevPrices = alLPrices;

      if (differencePrices.length > 0) {
        console.log("SEND CHANGED PRICE");
        console.log({ differencePrices });
        sendPrice(curTime, differencePrices);
      }

      if (clientConnected) {
        console.log("CLIENT CONNECTED - SEND PRICES");
        clientConnected = false;
        sendPrice(curTime, alLPrices);
      }
      if (curTime - preTime >= sendTime) {
        console.log("SEND PRICES SEQUENTIALLY");
        preTime = curTime;
        sendPrice(curTime, alLPrices);
      }
    } catch (error) {
      console.error(error);
    }
    await delay(
      process.env.BOT_INTERVAL ? parseInt(process.env.BOT_INTERVAL) : 6000
    );
  }
})();
