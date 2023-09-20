import { GenericError, SimulateCosmWasmClient } from "@oraichain/cw-simulate";

import {
  MarginedEngineClient,
  MarginedEngineTypes,
  MarginedVammClient,
  MarginedPricefeedClient,
  MarginedInsuranceFundClient,
  MarginedFeePoolClient,
} from "@oraichain/oraimargin-contracts-sdk";
import { OraiswapTokenClient } from "@oraichain/oraidex-contracts-sdk";
import {
  deployEngine,
  senderAddress,
  deployFeePool,
  deployInsuranceFund,
  deployPricefeed,
  deployToken,
  deployVamm,
  toDecimals,
  aliceAddress,
  bobAddress,
  carolAddress,
} from "./common";

import { EngineHandler } from "../index";
import { UserWallet } from "@oraichain/oraimargin-common";

const client = new SimulateCosmWasmClient({
  chainId: "Oraichain",
  bech32Prefix: "orai",
  metering: process.env.METERING === "true",
});

describe("perpetual-engine", () => {
  let insuranceFundContract: MarginedInsuranceFundClient;
  let usdcContract: OraiswapTokenClient;
  let engineContract: MarginedEngineClient;
  let pricefeedContract: MarginedPricefeedClient;
  let feepoolContract: MarginedFeePoolClient;
  let vammContract: MarginedVammClient;
  let sender: UserWallet;
  let engineHandler: EngineHandler;
  beforeEach(async () => {
    [senderAddress, bobAddress].forEach((address) =>
      client.app.bank.setBalance(address, [
        { denom: "orai", amount: "5000000000" },
      ])
    );

    sender = { client, address: senderAddress };

    [pricefeedContract, feepoolContract, usdcContract] = await Promise.all([
      deployPricefeed(client),
      deployFeePool(client),
      deployToken(client, {
        symbol: "USDC",
        decimals: 9,
        name: "USDC token",
        initial_balances: [
          { address: bobAddress, amount: toDecimals(5000) },
          { address: aliceAddress, amount: toDecimals(5000) },
        ],
      }),
    ]);

    engineContract = await deployEngine(client, {
      token: usdcContract.contractAddress,
      fee_pool: feepoolContract.contractAddress,
      initial_margin_ratio: toDecimals(0.05),
      maintenance_margin_ratio: toDecimals(0.05),
      tp_sl_spread: toDecimals(0.05),
      liquidation_fee: toDecimals(0.05),
    });
    insuranceFundContract = await deployInsuranceFund(client, {
      engine: engineContract.contractAddress,
    });
    await engineContract.updateConfig({
      insuranceFund: insuranceFundContract.contractAddress,
    });

    // mint insurance fund contract balance
    await usdcContract.mint({
      recipient: insuranceFundContract.contractAddress,
      amount: toDecimals(5000),
    });

    vammContract = await deployVamm(client, {
      pricefeed: pricefeedContract.contractAddress,
      insurance_fund: insuranceFundContract.contractAddress,
      base_asset_reserve: toDecimals(100),
      quote_asset_reserve: toDecimals(1000),
      toll_ratio: "0",
      spread_ratio: "0",
      fluctuation_limit_ratio: "0",
      funding_period: 86_400, // 1 day
      decimals: 9,
    });

    await vammContract.updateConfig({
      marginEngine: engineContract.contractAddress,
    });

    await vammContract.setOpen({ open: true });

    // register vamm
    await insuranceFundContract.addVamm({ vamm: vammContract.contractAddress });

    // append a price to the pricefeed
    await pricefeedContract.appendPrice({
      key: "ETH",
      price: toDecimals(10),
      timestamp: 1e9,
    });

    // increase allowance for engine contract
    await Promise.all(
      [bobAddress, aliceAddress].map((addr) => {
        usdcContract.sender = addr;
        return usdcContract.increaseAllowance({
          amount: toDecimals(2000),
          spender: engineContract.contractAddress,
        });
      })
    );

    engineHandler = new EngineHandler(sender, engineContract.contractAddress);
  });

  it("test_instantiation", async () => {
    let res = await engineContract.config();
    expect(res).toEqual<MarginedEngineTypes.ConfigResponse>({
      owner: senderAddress,
      insurance_fund: insuranceFundContract.contractAddress,
      fee_pool: feepoolContract.contractAddress,
      eligible_collateral: {
        token: { contract_addr: usdcContract.contractAddress },
      },
      decimals: toDecimals(1),
      initial_margin_ratio: "50000000",
      maintenance_margin_ratio: "50000000",
      partial_liquidation_ratio: "0",
      tp_sl_spread: "50000000",
      liquidation_fee: "50000000",
    });
  });

  it("test_calculateSpreadValue", async () => {
    const tpPrice = "20000000";
    const slPrice = "10000000";
    const tpslSpread = "5000";
    const decimals = "1000000";
    const tpSpread = engineHandler.calculateSpreadValue(
      tpPrice,
      tpslSpread,
      decimals
    );
    const slSpread = engineHandler.calculateSpreadValue(
      slPrice,
      tpslSpread,
      decimals
    );
    expect(Number(tpSpread)).toEqual(100000);
    expect(Number(slSpread)).toEqual(50000);
  });

  it("test_willTpSl", async () => {
    const tpPrice = 20000000;
    const slPrice = 10000000;
    const tpslSpread = "5000";
    const decimals = "1000000";
    const tpSpread = engineHandler.calculateSpreadValue(
      tpPrice.toString(),
      tpslSpread,
      decimals
    );
    const slSpread = engineHandler.calculateSpreadValue(
      slPrice.toString(),
      tpslSpread,
      decimals
    );
    expect(Number(tpSpread)).toEqual(100000);
    expect(Number(slSpread)).toEqual(50000);

    // spot price = take profit price
    let spotPrice = tpPrice;
    let willTriggetTpSl = engineHandler.willTpSl(
      BigInt(spotPrice),
      BigInt(tpPrice),
      BigInt(slPrice ?? "0"),
      tpSpread.toString(),
      slSpread.toString(),
      "buy"
    );
    expect(willTriggetTpSl).toEqual(true);

    // spot price > take profit price
    spotPrice = tpPrice + Number(tpSpread);
    expect(spotPrice).toEqual(20100000);
    willTriggetTpSl = engineHandler.willTpSl(
      BigInt(spotPrice),
      BigInt(tpPrice),
      BigInt(slPrice ?? "0"),
      tpSpread.toString(),
      slSpread.toString(),
      "buy"
    );
    expect(willTriggetTpSl).toEqual(true);

    // spot price + tpSpread = take profit price
    spotPrice = tpPrice - Number(tpSpread);
    expect(spotPrice).toEqual(19900000);
    willTriggetTpSl = engineHandler.willTpSl(
      BigInt(spotPrice),
      BigInt(tpPrice),
      BigInt(slPrice ?? "0"),
      tpSpread.toString(),
      slSpread.toString(),
      "buy"
    );
    expect(willTriggetTpSl).toEqual(true);

    // spot price + tpSpread + 1 = take profit price
    spotPrice = tpPrice - Number(tpSpread) - 1;
    expect(spotPrice).toEqual(19899999);
    willTriggetTpSl = engineHandler.willTpSl(
      BigInt(spotPrice),
      BigInt(tpPrice),
      BigInt(slPrice ?? "0"),
      tpSpread.toString(),
      slSpread.toString(),
      "buy"
    );
    expect(willTriggetTpSl).toEqual(false);

    // spot price = stop loss price
    spotPrice = slPrice;
    willTriggetTpSl = engineHandler.willTpSl(
      BigInt(spotPrice),
      BigInt(tpPrice),
      BigInt(slPrice ?? "0"),
      tpSpread.toString(),
      slSpread.toString(),
      "buy"
    );
    expect(willTriggetTpSl).toEqual(true);

    // spot price < stop loss price
    spotPrice = slPrice - Number(slSpread);
    expect(spotPrice).toEqual(9950000);
    willTriggetTpSl = engineHandler.willTpSl(
      BigInt(spotPrice),
      BigInt(tpPrice),
      BigInt(slPrice ?? "0"),
      tpSpread.toString(),
      slSpread.toString(),
      "buy"
    );
    expect(willTriggetTpSl).toEqual(true);

    // spot price = stop loss price + slSpread
    spotPrice = slPrice + Number(slSpread);
    expect(spotPrice).toEqual(10050000);
    willTriggetTpSl = engineHandler.willTpSl(
      BigInt(spotPrice),
      BigInt(tpPrice),
      BigInt(slPrice ?? "0"),
      tpSpread.toString(),
      slSpread.toString(),
      "buy"
    );
    expect(willTriggetTpSl).toEqual(true);

    // spot price = stop loss price + slSpread + 1
    spotPrice = slPrice + Number(slSpread) + 1;
    expect(spotPrice).toEqual(10050001);
    willTriggetTpSl = engineHandler.willTpSl(
      BigInt(spotPrice),
      BigInt(tpPrice),
      BigInt(slPrice ?? "0"),
      tpSpread.toString(),
      slSpread.toString(),
      "buy"
    );
    expect(willTriggetTpSl).toEqual(false);
  });

  it("test_queryAllPositions", async () => {
    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(60),
      leverage: toDecimals(10),
      baseAssetLimit: toDecimals(0),
      takeProfit: toDecimals(20),
      stopLoss: toDecimals(14),
    });
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(50),
      leverage: toDecimals(10),
      baseAssetLimit: toDecimals(0),
      takeProfit: toDecimals(50),
      stopLoss: toDecimals(14),
    });
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(40),
      leverage: toDecimals(10),
      baseAssetLimit: toDecimals(0),
      takeProfit: toDecimals(60),
      stopLoss: toDecimals(14),
    });
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "sell",
      marginAmount: toDecimals(30),
      leverage: toDecimals(10),
      baseAssetLimit: toDecimals(0),
      takeProfit: toDecimals(30),
      stopLoss: toDecimals(70),
    });
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "sell",
      marginAmount: toDecimals(20),
      leverage: toDecimals(10),
      baseAssetLimit: toDecimals(0),
      takeProfit: toDecimals(20),
      stopLoss: toDecimals(70),
    });
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(10),
      leverage: toDecimals(10),
      baseAssetLimit: toDecimals(0),
      takeProfit: toDecimals(50),
      stopLoss: toDecimals(14),
    });

    let ticks = await engineHandler.queryAllTicks(
      vammContract.contractAddress,
      "buy"
    );
    console.log({ ticks });

    expect(ticks[0]).toEqual({
      entry_price: "52500000000",
      total_positions: 1,
    });
    let postions = await engineHandler.queryPositionsbyPrice(
      vammContract.contractAddress,
      "buy",
      ticks[0].entry_price
    );
    expect(postions[0].position_id).toEqual(3);
    expect(postions[0].margin).toEqual("40000000000");
    expect(postions[0].take_profit).toEqual("60000000000");
    expect(postions[0].stop_loss).toEqual("14000000000");

    expect(ticks[1]).toEqual({
      entry_price: "41999999999",
      total_positions: 1,
    });
    postions = await engineHandler.queryPositionsbyPrice(
      vammContract.contractAddress,
      "buy",
      ticks[1].entry_price
    );
    expect(postions[0].position_id).toEqual(6);
    expect(postions[0].margin).toEqual("10000000000");
    expect(postions[0].take_profit).toEqual("50000000000");
    expect(postions[0].stop_loss).toEqual("14000000000");

    expect(ticks[2]).toEqual({
      entry_price: "33600000002",
      total_positions: 1,
    });
    postions = await engineHandler.queryPositionsbyPrice(
      vammContract.contractAddress,
      "buy",
      ticks[2].entry_price
    );
    expect(postions[0].position_id).toEqual(2);
    expect(postions[0].margin).toEqual("50000000000");
    expect(postions[0].take_profit).toEqual("50000000000");
    expect(postions[0].stop_loss).toEqual("14000000000");

    expect(ticks[3]).toEqual({
      entry_price: "16000000000",
      total_positions: 1,
    });
    postions = await engineHandler.queryPositionsbyPrice(
      vammContract.contractAddress,
      "buy",
      ticks[3].entry_price
    );
    expect(postions[0].position_id).toEqual(1);
    expect(postions[0].margin).toEqual("60000000000");
    expect(postions[0].take_profit).toEqual("20000000000");
    expect(postions[0].stop_loss).toEqual("14000000000");

    ticks = await engineHandler.queryAllTicks(
      vammContract.contractAddress,
      "sell"
    );
    console.log({ ticks });
    expect(ticks[0]).toEqual({
      entry_price: "43999999994",
      total_positions: 1,
    });
    postions = await engineHandler.queryPositionsbyPrice(
      vammContract.contractAddress,
      "sell",
      ticks[0].entry_price
    );
    expect(postions[0].position_id).toEqual(5);
    expect(postions[0].margin).toEqual("20000000000");
    expect(postions[0].take_profit).toEqual("20000000000");
    expect(postions[0].stop_loss).toEqual("70000000000");

    expect(ticks[1]).toEqual({
      entry_price: "54999999995",
      total_positions: 1,
    });
    postions = await engineHandler.queryPositionsbyPrice(
      vammContract.contractAddress,
      "sell",
      ticks[1].entry_price
    );
    expect(postions[0].position_id).toEqual(4);
    expect(postions[0].margin).toEqual("30000000000");
    expect(postions[0].take_profit).toEqual("30000000000");
    expect(postions[0].stop_loss).toEqual("70000000000");
  });

  it("test_slippage", async () => {
    // OPEN POSITIONS TEST

    // amount: margin * leverage
    // direction: - long <-> add_to_amm
    //            - short <-> remove_from_amm
    let simulateInputAmt = await vammContract.inputAmount({
      amount: toDecimals(25),
      direction: "add_to_amm",
    });
    console.log({ simulateInputAmt });

    engineContract.sender = aliceAddress;
    // Open position successfully if baseAssetLimit = 0
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(5),
      leverage: toDecimals(5),
      baseAssetLimit: toDecimals(0),
      takeProfit: toDecimals(20),
      stopLoss: toDecimals(10),
    });
    const alicePosition_1 = await engineContract.position({
      positionId: 1,
      vamm: vammContract.contractAddress,
    });
    expect(alicePosition_1.notional).toEqual(toDecimals(25));
    expect(alicePosition_1.size).toEqual(simulateInputAmt);

    simulateInputAmt = await vammContract.inputAmount({
      amount: toDecimals(20),
      direction: "add_to_amm",
    });
    console.log({ simulateInputAmt });
    expect(simulateInputAmt).toEqual("1867195705");

    // For long position: baseAssetLimit = 1900000000 > 1867195705 => cannot open position
    await expect(
      engineContract.openPosition({
        vamm: vammContract.contractAddress,
        side: "buy",
        marginAmount: toDecimals(5),
        leverage: toDecimals(4),
        baseAssetLimit: "1900000000",
        takeProfit: toDecimals(20),
        stopLoss: toDecimals(10),
      })
    ).rejects.toThrow(new GenericError("open position failure - reply (id 1)"));

    // For long position: baseAssetLimit = 1800000000 <= 1867195705 = simulateInputAmt => Open position successfully
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(5),
      leverage: toDecimals(4),
      baseAssetLimit: "1800000000",
      takeProfit: toDecimals(20),
      stopLoss: toDecimals(10),
    });

    const alicePosition_3 = await engineContract.position({
      positionId: 3,
      vamm: vammContract.contractAddress,
    });
    expect(alicePosition_3.notional).toEqual(toDecimals(20));
    expect(alicePosition_3.size).toEqual(simulateInputAmt);

    simulateInputAmt = await vammContract.inputAmount({
      amount: toDecimals(10),
      direction: "add_to_amm",
    });
    console.log({ simulateInputAmt });
    expect(simulateInputAmt).toEqual("907050046");

    // For long position: baseAssetLimit = 907050046 = 907050046 = simulateInputAmt => Open position successfully
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(5),
      leverage: toDecimals(2),
      baseAssetLimit: "907050046",
      takeProfit: toDecimals(30),
      stopLoss: toDecimals(10),
    });

    const alicePosition_4 = await engineContract.position({
      positionId: 4,
      vamm: vammContract.contractAddress,
    });
    expect(alicePosition_4.notional).toEqual(toDecimals(10));
    expect(alicePosition_4.size).toEqual(simulateInputAmt);

    // amount: margin * leverage
    // direction: - long <-> add_to_amm
    //            - short <-> remove_from_amm
    simulateInputAmt = await vammContract.inputAmount({
      amount: toDecimals(15),
      direction: "remove_from_amm",
    });
    console.log({ simulateInputAmt });
    expect(simulateInputAmt).toEqual("1367116297");

    engineContract.sender = bobAddress;
    // Open position successfully if baseAssetLimit = 0
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "sell",
      marginAmount: toDecimals(3),
      leverage: toDecimals(5),
      baseAssetLimit: toDecimals(0),
      takeProfit: toDecimals(5),
      stopLoss: toDecimals(30),
    });
    const bobPosition_5 = await engineContract.position({
      positionId: 5,
      vamm: vammContract.contractAddress,
    });
    // // Because of this is short position. size is negative
    expect(bobPosition_5.notional).toEqual(toDecimals(15));
    expect(bobPosition_5.size).toEqual("-1367116297");

    simulateInputAmt = await vammContract.inputAmount({
      amount: toDecimals(10),
      direction: "remove_from_amm",
    });
    console.log({ simulateInputAmt });
    expect(simulateInputAmt).toEqual("933532487");

    // For short position: baseAssetLimit = -900000000 > -933532487 (negative value) => cannot open position
    await expect(
      engineContract.openPosition({
        vamm: vammContract.contractAddress,
        side: "sell",
        marginAmount: toDecimals(2),
        leverage: toDecimals(5),
        baseAssetLimit: "900000000",
        takeProfit: toDecimals(5),
        stopLoss: toDecimals(30),
      })
    ).rejects.toThrow(new GenericError("open position failure - reply (id 1)"));

    // For short position: baseAssetLimit = -933532487 = -933532487 = simulateInputAmt (negative value) => Open position successfully
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "sell",
      marginAmount: toDecimals(2),
      leverage: toDecimals(5),
      baseAssetLimit: "933532487",
      takeProfit: toDecimals(5),
      stopLoss: toDecimals(30),
    });

    const bobPosition_7 = await engineContract.position({
      positionId: 7,
      vamm: vammContract.contractAddress,
    });
    expect(bobPosition_7.notional).toEqual(toDecimals(10));
    expect(bobPosition_7.size).toEqual("-933532487");

    simulateInputAmt = await vammContract.inputAmount({
      amount: toDecimals(8),
      direction: "remove_from_amm",
    });
    console.log({ simulateInputAmt });
    expect(simulateInputAmt).toEqual("759979481");

    // For short position: baseAssetLimit = -759979482 < -759979481 = simulateInputAmt (negative value) => Open position successfully
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "sell",
      marginAmount: toDecimals(4),
      leverage: toDecimals(2),
      baseAssetLimit: "759979482",
      takeProfit: toDecimals(5),
      stopLoss: toDecimals(30),
    });

    const bobPosition_8 = await engineContract.position({
      positionId: 8,
      vamm: vammContract.contractAddress,
    });
    expect(bobPosition_8.notional).toEqual(toDecimals(8));
    expect(bobPosition_8.size).toEqual("-759979481");

    // CLOSE POSITIONS TEST
    // Close position successfully if quoteAssetLimit = 0
    engineContract.sender = aliceAddress;
    let tx = await engineContract.closePosition({
      positionId: 1,
      quoteAssetLimit: toDecimals(0),
      vamm: vammContract.contractAddress,
    });
    expect(tx.events[1].attributes[1].value).toContain("close_position");
    expect(tx.events[1].attributes[5].value).toContain("1");
    await expect(
      engineContract.position({
        positionId: 1,
        vamm: vammContract.contractAddress,
      })
    ).rejects.toThrow("margined_perp::margined_engine::Position not found");

    // amount: position size
    // direction: - long <-> add_to_amm
    //            - short <-> remove_from_amm
    console.log("alicePosition_4.size: ", alicePosition_4.size.toString());

    let simulateOutAmt = await vammContract.outputAmount({
      amount: alicePosition_4.size.toString(),
      direction: "add_to_amm",
    });
    console.log({ simulateOutAmt });
    expect(simulateOutAmt).toEqual("8937930143");

    // For long position: quoteAssetLimit = 9000000000 > 8937930143 = simulateOutAmt => cannot close position
    await expect(
      engineContract.closePosition({
        positionId: 4,
        quoteAssetLimit: "9000000000",
        vamm: vammContract.contractAddress,
      })
    ).rejects.toThrow(
      new GenericError("close position failure - reply (id 2)")
    );

    // For long position: quoteAssetLimit = 8937930142 <= 8937930143 = simulateOutAmt => close position successfully
    tx = await engineContract.closePosition({
      positionId: 4,
      quoteAssetLimit: "8937930142",
      vamm: vammContract.contractAddress,
    });
    expect(tx.events[1].attributes[1].value).toContain("close_position");
    expect(tx.events[3].attributes[7].value).toContain("4");
    expect(tx.events[3].attributes[8].value).toContain(simulateOutAmt);
    await expect(
      engineContract.position({
        positionId: 4,
        vamm: vammContract.contractAddress,
      })
    ).rejects.toThrow("margined_perp::margined_engine::Position not found");

    // Close position successfully if quoteAssetLimit = 0
    engineContract.sender = bobAddress;
    tx = await engineContract.closePosition({
      positionId: 5,
      quoteAssetLimit: toDecimals(0),
      vamm: vammContract.contractAddress,
    });
    expect(tx.events[1].attributes[1].value).toContain("close_position");
    expect(tx.events[1].attributes[5].value).toContain("5");
    await expect(
      engineContract.position({
        positionId: 5,
        vamm: vammContract.contractAddress,
      })
    ).rejects.toThrow("margined_perp::margined_engine::Position not found");

    simulateOutAmt = await vammContract.outputAmount({
      amount: Math.abs(Number(bobPosition_7.size)).toString(),
      direction: "remove_from_amm",
    });
    console.log({ simulateOutAmt });
    expect(simulateOutAmt).toEqual("9456268359");

    // For short position: quoteAssetLimit = -9000000000 > -9456268359 = simulateOutAmt => cannot close position
    await expect(
      engineContract.closePosition({
        positionId: 7,
        quoteAssetLimit: "9000000000",
        vamm: vammContract.contractAddress,
      })
    ).rejects.toThrow(
      new GenericError("close position failure - reply (id 2)")
    );

    // For short position: quoteAssetLimit = -9456268360 <= -9456268359 = simulateOutAmt => cannot close position
    tx = await engineContract.closePosition({
      positionId: 7,
      quoteAssetLimit: "9456268360",
      vamm: vammContract.contractAddress,
    });
    expect(tx.events[1].attributes[1].value).toContain("close_position");
    expect(tx.events[3].attributes[7].value).toContain("7");
    expect(tx.events[3].attributes[8].value).toContain(simulateOutAmt);
    await expect(
      engineContract.position({
        positionId: 7,
        vamm: vammContract.contractAddress,
      })
    ).rejects.toThrow("margined_perp::margined_engine::Position not found");
  });

  it("test_take_profit", async () => {
    let balanceRes = await usdcContract.balance({ address: aliceAddress });
    expect(balanceRes.balance).toBe("5000000000000");

    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(60),
      leverage: toDecimals(10),
      baseAssetLimit: toDecimals(0),
      takeProfit: toDecimals(20),
      stopLoss: toDecimals(14),
    });
    const alicePosition = await engineContract.position({
      positionId: 1,
      vamm: vammContract.contractAddress,
    });
    balanceRes = await usdcContract.balance({ address: aliceAddress });
    expect(balanceRes.balance).toBe("4940000000000");

    expect(alicePosition.margin).toEqual(toDecimals(60));
    expect(alicePosition.take_profit).toEqual(toDecimals(20));
    expect(alicePosition.stop_loss).toEqual(toDecimals(14));

    let spotPrice = await vammContract.spotPrice();
    expect(spotPrice).toEqual(toDecimals(25.6));

    engineContract.sender = bobAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "sell",
      marginAmount: toDecimals(6),
      leverage: toDecimals(8),
      baseAssetLimit: toDecimals(0),
      takeProfit: toDecimals(20),
      stopLoss: toDecimals(28),
    });
    const bobPosition = await engineContract.position({
      positionId: 2,
      vamm: vammContract.contractAddress,
    });

    spotPrice = await vammContract.spotPrice();
    expect(spotPrice).toEqual("24087039999");

    expect(bobPosition.margin).toEqual(toDecimals(6));
    expect(bobPosition.take_profit).toEqual(toDecimals(20));
    expect(bobPosition.stop_loss).toEqual(toDecimals(28));

    const longMsgs = await engineHandler.triggerTpSl(
      vammContract.contractAddress,
      "buy"
    );
    const longTx = await sender.client.executeMultiple(
      sender.address,
      longMsgs,
      "auto"
    );
    console.dir(longTx.events, { depth: 4 });
    await expect(
      engineContract.position({
        positionId: 1,
        vamm: vammContract.contractAddress,
      })
    ).rejects.toThrow("margined_perp::margined_engine::Position not found");

    balanceRes = await usdcContract.balance({ address: aliceAddress });
    expect(balanceRes.balance).toBe("4970963337545");
    expect(longTx.events[1].attributes[1].value).toContain(
      "trigger_take_profit"
    );
  });

  it("test_stop_loss", async () => {
    let balanceRes = await usdcContract.balance({ address: aliceAddress });
    expect(balanceRes.balance).toBe("5000000000000");

    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(6),
      leverage: toDecimals(2),
      baseAssetLimit: toDecimals(0),
      takeProfit: toDecimals(20),
      stopLoss: toDecimals(10),
    });

    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(6),
      leverage: toDecimals(1),
      baseAssetLimit: toDecimals(0),
      takeProfit: toDecimals(20),
      stopLoss: toDecimals(10),
    });

    const alicePosition = await engineContract.position({
      positionId: 1,
      vamm: vammContract.contractAddress,
    });
    balanceRes = await usdcContract.balance({ address: aliceAddress });
    expect(balanceRes.balance).toBe("4988000000000");

    expect(alicePosition.margin).toEqual(toDecimals(6));
    expect(alicePosition.take_profit).toEqual(toDecimals(20));
    expect(alicePosition.stop_loss).toEqual(toDecimals(10));

    let spotPrice = await vammContract.spotPrice();
    expect(spotPrice).toEqual("10363239999");

    engineContract.sender = bobAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "sell",
      marginAmount: toDecimals(4),
      leverage: toDecimals(10),
      baseAssetLimit: toDecimals(0),
      takeProfit: toDecimals(5),
      stopLoss: toDecimals(40),
    });
    let bobPosition = await engineContract.position({
      positionId: 3,
      vamm: vammContract.contractAddress,
    });

    spotPrice = await vammContract.spotPrice();
    expect(spotPrice).toEqual("9564839999");

    expect(bobPosition.margin).toEqual(toDecimals(4));
    expect(bobPosition.take_profit).toEqual(toDecimals(5));
    expect(bobPosition.stop_loss).toEqual(toDecimals(40));

    const longMsgs = await engineHandler.triggerTpSl(
      vammContract.contractAddress,
      "buy"
    );
    const longTx = await sender.client.executeMultiple(
      sender.address,
      longMsgs,
      "auto"
    );
    console.dir(longTx, { depth: 4 });
    expect(longTx.events[1].attributes[1].value).toContain("trigger_stop_loss");
    balanceRes = await usdcContract.balance({ address: aliceAddress });
    expect(balanceRes.balance).toBe("4998624802520");
  });

  it("test_liquidate", async () => {
    let balanceRes = await usdcContract.balance({ address: aliceAddress });
    expect(balanceRes.balance).toBe("5000000000000");

    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(25),
      leverage: toDecimals(10),
      baseAssetLimit: toDecimals(0),
      takeProfit: toDecimals(20),
      stopLoss: toDecimals(10),
    });

    let spotPrice = await vammContract.spotPrice();
    expect(spotPrice).toEqual("15625000000");

    engineContract.sender = bobAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "sell",
      marginAmount: toDecimals(40),
      leverage: toDecimals(10),
      baseAssetLimit: toDecimals(0),
      takeProfit: toDecimals(5),
      stopLoss: toDecimals(30),
    });
    spotPrice = await vammContract.spotPrice();
    expect(spotPrice).toEqual("7224999999");
    const liquidateMsgs = await engineHandler.triggerLiquidate(
      vammContract.contractAddress,
      "buy"
    );
    const tx = await sender.client.executeMultiple(
      sender.address,
      liquidateMsgs,
      "auto"
    );
    console.dir(tx, { depth: 4 });
    expect(tx.events[1].attributes[1].value).toContain("liquidate");
    balanceRes = await usdcContract.balance({ address: aliceAddress });
    expect(balanceRes.balance).toBe("4975000000000");
  });
});
