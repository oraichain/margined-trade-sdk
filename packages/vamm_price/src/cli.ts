import dotenv from "dotenv";
import { queryAllVammSpotPrice } from "./index";
import {
  encrypt,
  decrypt,
  delay,
  setupWallet,
} from "@oraichain/oraimargin-common";
import WebSocket from "ws";
dotenv.config();

const wss = new WebSocket.Server({ port: 3001 });

(async () => {
  const insurance_contractAddr = process.env.INSURANCE_FUND_CONTRACT;
  const sendTime = process.env.SEND_TIME ? Number(process.env.SEND_TIME) : 3600;
  console.log({ sendTime });
  const sender = await setupWallet(
    decrypt(
      process.env.MNEMONIC_PASS,
      process.env.MNEMONIC_ENCRYPTED
    )
  );

  let prevPrices: string[] = [];
  let preTime: number = 0;
  while (true) {
    try {
      let curTime = Math.floor(Date.now() / 1000);
      console.log({ curTime });
      const alLPrices = await queryAllVammSpotPrice(
        sender,
        insurance_contractAddr
      );
      console.log({ alLPrices });

      const differencePrices =
        prevPrices.length === 0
          ? alLPrices
          : prevPrices.filter((x) => !alLPrices.includes(x));
      prevPrices = alLPrices;
      console.log({ differencePrices });

      if (differencePrices.length > 0) {
        console.log("PRICE CHANGE");
        let time = Math.floor(Date.now() / 1000);
        for (const spotPrice of differencePrices) {
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
      }

      if (curTime - preTime >= sendTime) {
        console.log("Send prices sequentially");
        preTime = curTime;
        console.log({ preTime });
        for (const spotPrice of alLPrices) {
          wss.clients.forEach((ws) => {
            ws.send(
              JSON.stringify({
                event: "market_price",
                pair_price: spotPrice,
                time: curTime,
              })
            );
          });
        }
      }
    } catch (error) {
      console.error(error);
    }
    await delay(3000);
  }
})();
