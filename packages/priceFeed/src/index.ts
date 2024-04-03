import { UserWallet, getPriceFeed } from "@oraichain/oraitrading-common";
import { ExecuteInstruction } from "@cosmjs/cosmwasm-stargate";

import {
  Addr,
  MarginedEngineQueryClient,
  MarginedPricefeedTypes,
} from "@oraichain/oraimargin-contracts-sdk";

export class priceFeedHandler {
  public engineClient: MarginedEngineQueryClient;
  constructor(public sender: UserWallet, private engine: string) {
    this.engineClient = new MarginedEngineQueryClient(sender.client, engine);
  }

  async getNativeBalance(address?: string, denom?: string) {
    const balance = await this.sender.client.getBalance(
      address ?? this.sender.address,
      denom ?? "orai"
    );
    return BigInt(balance.amount);
  }

  async executeMultiple(instructions: ExecuteInstruction[]) {
    return this.sender.client.executeMultiple(
      this.sender.address,
      instructions,
      "auto"
    );
  }

  async appendOraiprice(priceFeed: Addr): Promise<ExecuteInstruction[]> {
    const decimals = Number((await this.engineClient.config()).decimals);
    const oraclePrice = Math.round(
      (await getPriceFeed("ORAI", "https://pricefeed.oraichainlabs.org/")) *
        decimals
    );
    if (oraclePrice === 0) {
      console.log("Oracle price is ZERO!");
      return [];
    }
    console.log({ oraclePrice });
    let time = Math.floor(Date.now() / 1000) - 12;
    console.log({ time });
    const appendPrice = {
      append_price: {
        key: "ORAI",
        price: oraclePrice.toString(),
        timestamp: time,
      },
    } as MarginedPricefeedTypes.ExecuteMsg;

    console.log({ appendPrice });
    return [
      {
        contractAddress: priceFeed,
        msg: appendPrice,
      },
    ];
  }

  async appendInjprice(priceFeed: Addr): Promise<ExecuteInstruction[]> {
    const decimals = Number((await this.engineClient.config()).decimals);
    const oraclePrice = Math.round(
      (await getPriceFeed(
        "INJ",
        "https://pricefeed-futures.oraichainlabs.org/inj"
      )) * decimals
    );
    if (oraclePrice === 0) {
      console.log("Oracle price is ZERO!");
      return [];
    }
    console.log({ oraclePrice });
    let time = Math.floor(Date.now() / 1000) - 12;
    console.log({ time });
    const appendPrice = {
      append_price: {
        key: "INJ",
        price: oraclePrice.toString(),
        timestamp: time,
      },
    } as MarginedPricefeedTypes.ExecuteMsg;

    console.log({ appendPrice });
    return [
      {
        contractAddress: priceFeed,
        msg: appendPrice,
      },
    ];
  }

  async appendPrice(
    priceFeed: Addr,
    key: string,
    url: string
  ): Promise<ExecuteInstruction[]> {
    const decimals = Number((await this.engineClient.config()).decimals);
    const oraclePrice = Math.round((await getPriceFeed(key, url)) * decimals);
    if (oraclePrice === 0) {
      console.log("Oracle price is ZERO!");
      return [];
    }
    console.log({ oraclePrice });
    let time = Math.floor(Date.now() / 1000) - 12;
    console.log({ time });
    const appendPrice = {
      append_price: {
        key,
        price: oraclePrice.toString(),
        timestamp: time,
      },
    } as MarginedPricefeedTypes.ExecuteMsg;

    return [
      {
        contractAddress: priceFeed,
        msg: appendPrice,
      },
    ];
  }
}

export async function executePriceFeed(
  engineHandler: priceFeedHandler
): Promise<ExecuteInstruction[]> {
  const priceFeed = process.env.PRICEFEED_CONTRACT;
  console.log({ priceFeed });
  const [appendOraiPrice, appendInjPrice, appendBTCPrice] = await Promise.all([
    engineHandler.appendPrice(
      priceFeed,
      "ORAI",
      "https://pricefeed.oraichainlabs.org/"
    ),
    engineHandler.appendPrice(
      priceFeed,
      "INJ",
      "https://pricefeed-futures.oraichainlabs.org/inj"
    ),
    engineHandler.appendPrice(
      priceFeed,
      "BTC",
      "https://pricefeed-futures.oraichainlabs.org/btc"
    ),
  ]);

  const priceMsg: ExecuteInstruction[] = [
    ...appendOraiPrice,
    ...appendInjPrice,
    ...appendBTCPrice,
  ];

  console.log(priceMsg);
  return priceMsg;
}
