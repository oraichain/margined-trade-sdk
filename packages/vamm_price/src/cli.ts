import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { stringToPath } from "@cosmjs/crypto";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { GasPrice } from "@cosmjs/stargate";
import dotenv from 'dotenv';
import { queryAllVammSpotPrice } from "./index";
import { UserWallet, delay } from "./helpers";
import WebSocket from 'ws';
dotenv.config();

const mnemonicMinLength = 12; // 12 words
const wss = new WebSocket.Server({ port: 3001 });

(async () => {
  const prefix = "orai";
  const mnemonic = process.env["MNEMONIC"];
  const mnemonicWords = mnemonic.split(" ");
  const insurance_contractAddr = process.env.INSURANCE_FUND_CONTRACT;
  const sendTime = process.env.SEND_TIME ? Number(process.env.SEND_TIME) : 3600;
  console.log({ sendTime });
  
  if (
    !mnemonic ||
    (mnemonicWords.length != mnemonicMinLength &&
      mnemonicWords.length != mnemonicMinLength * 2)
  ) {
    throw new Error(
      `Must set MNEMONIC to a 12 or word phrase. Has: ${mnemonic.length}`
    );
  }
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    hdPaths: [stringToPath(process.env.HD_PATH || "m/44'/118'/0'/0/0")],
    prefix,
  });
  const [firstAccount] = await wallet.getAccounts();
  const sender: UserWallet = {
    address: firstAccount.address,
    client: await SigningCosmWasmClient.connectWithSigner(
      process.env.RPC_URL!,
      wallet,
      {
        gasPrice: GasPrice.fromString("0.002orai"),
      }
    )
  }
  let prevPrices: string[] = [];
  let preTime: number = 0
  while (true) {
    try {
      let curTime = Math.floor(Date.now() / 1000);
      console.log({ curTime });
      const alLPrices = await queryAllVammSpotPrice(sender, insurance_contractAddr);
      console.log({ alLPrices });
      const differencePrices = prevPrices.length === 0 ? alLPrices : prevPrices.filter(x => !alLPrices.includes(x));
      prevPrices = alLPrices;
      console.log({ differencePrices });
      if (differencePrices.length > 0) {
        console.log("PRICE CHANGE");
        let time = Math.floor(Date.now() / 1000);
        for (const spotPrice of differencePrices) {
          wss.clients.forEach(ws => {
            ws.send(JSON.stringify({
              event: "market_price",
              pair_price: spotPrice,
              time
            }));
          })
        }
      }

      if (curTime - preTime >= sendTime) {
        console.log("Send prices sequentially");
        preTime = curTime;
        console.log({ preTime });
        for (const spotPrice of alLPrices) {
          wss.clients.forEach(ws => {
            ws.send(JSON.stringify({
              event: "market_price",
              pair_price: spotPrice,
              time: curTime
            }));
          })
        }
      }
    } catch (error) {
      console.error(error);
    }
    await delay(3000);
  }
})();
