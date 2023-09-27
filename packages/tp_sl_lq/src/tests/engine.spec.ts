import { GenericError, SimulateCosmWasmClient } from "@oraichain/cw-simulate";

import {
  MarginedEngineClient,
  MarginedEngineTypes,
  MarginedVammClient,
  MarginedPricefeedClient,
  MarginedInsuranceFundClient,
  MarginedFeePoolClient,
} from "@oraichain/oraimargin-contracts-sdk";
import {
  OraiswapTokenClient,
  OraiswapTokenTypes,
} from "@oraichain/oraidex-contracts-sdk";
import {
  deployEngine,
  bobAddress,
  senderAddress,
  deployFeePool,
  deployInsuranceFund,
  deployPricefeed,
  deployToken,
  deployVamm,
  toDecimals,
  aliceAddress,
  carolAddress,
} from "./common";
import { Ok } from "ts-results";

const client = new SimulateCosmWasmClient({
  chainId: "Oraichain",
  bech32Prefix: "orai",
  metering: process.env.METERING === "true",
});

describe("engine", () => {
  let insuranceFundContract: MarginedInsuranceFundClient;
  let usdcContract: OraiswapTokenClient;
  let engineContract: MarginedEngineClient;
  let pricefeedContract: MarginedPricefeedClient;
  let feepoolContract: MarginedFeePoolClient;
  let vammContract: MarginedVammClient;

  beforeEach(async () => {
    [senderAddress, bobAddress].forEach((address) =>
      client.app.bank.setBalance(address, [
        { denom: "orai", amount: "5000000000" },
      ])
    );
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
      // margin_engine: engineContract.contractAddress,
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

  it("test_cannot_increase_position_when_bad_debt", async () => {
    usdcContract.sender = aliceAddress;
    await usdcContract.decreaseAllowance({
      amount: toDecimals(1940),
      spender: engineContract.contractAddress,
    });

    // alice open small long
    // position size: 7.40740741
    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(10),
      leverage: toDecimals(8),
      baseAssetLimit: toDecimals(4),
      takeProfit: toDecimals(11),
      stopLoss: toDecimals(0),
    });

    // bob drop spot price
    engineContract.sender = bobAddress;
    for (let i = 0; i < 5; ++i) {
      await engineContract.openPosition({
        vamm: vammContract.contractAddress,
        side: "sell",
        marginAmount: toDecimals(10),
        leverage: toDecimals(10),
        baseAssetLimit: toDecimals(0),
        takeProfit: toDecimals(1),
        stopLoss: toDecimals(12),
      });
    }

    // increase position should fail since margin is not enough
    engineContract.sender = aliceAddress;
    await expect(
      engineContract.openPosition({
        vamm: vammContract.contractAddress,
        side: "buy",
        marginAmount: toDecimals(10),
        leverage: toDecimals(10, 18),
        baseAssetLimit: toDecimals(0),
        takeProfit: toDecimals(15, 18),
        stopLoss: toDecimals(0),
      })
    ).rejects.toThrow(new GenericError("Position is undercollateralized"));

    engineContract.sender = bobAddress;
    await engineContract.closePosition({
      vamm: vammContract.contractAddress,
      positionId: 2,
      quoteAssetLimit: toDecimals(0),
    });
    await engineContract.closePosition({
      vamm: vammContract.contractAddress,
      positionId: 3,
      quoteAssetLimit: toDecimals(0),
    });

    engineContract.sender = aliceAddress;
    let result = await engineContract.depositMargin({
      vamm: vammContract.contractAddress,
      positionId: 1,
      amount: toDecimals(10),
    });

    console.log(result);
  });

  it("test_cannot_reduce_position_when_bad_debt", async () => {
    usdcContract.sender = aliceAddress;
    await usdcContract.decreaseAllowance({
      amount: toDecimals(1940),
      spender: engineContract.contractAddress,
    });

    // alice open small long
    // position size: 7.40740741
    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(10),
      leverage: toDecimals(8),
      baseAssetLimit: toDecimals(4),
      takeProfit: toDecimals(15),
      stopLoss: toDecimals(0),
    });
    // bob drop spot price
    engineContract.sender = bobAddress;
    for (let i = 0; i < 5; ++i) {
      await engineContract.openPosition({
        vamm: vammContract.contractAddress,
        side: "sell",
        marginAmount: toDecimals(1),
        leverage: toDecimals(10),
        baseAssetLimit: toDecimals(0),
        takeProfit: toDecimals(3),
        stopLoss: toDecimals(15),
      });
    }

    // increase position should fail since margin is not enough
    engineContract.sender = aliceAddress;
    await expect(
      engineContract.openPosition({
        vamm: vammContract.contractAddress,
        side: "sell",
        marginAmount: "5",
        leverage: toDecimals(1, 18),
        baseAssetLimit: toDecimals(0),
        takeProfit: toDecimals(1),
        stopLoss: toDecimals(20),
      })
    ).rejects.toThrow(new GenericError("Position is undercollateralized"));

    // pump spot price
    engineContract.sender = bobAddress;
    await engineContract.closePosition({
      vamm: vammContract.contractAddress,
      positionId: 6,
      quoteAssetLimit: "0",
    });

    // increase position should succeed since the position no longer has bad debt
    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "sell",
      marginAmount: toDecimals(1),
      leverage: toDecimals(1),
      baseAssetLimit: toDecimals(0),
      takeProfit: toDecimals(1),
      stopLoss: toDecimals(20),
    });
  });

  it("test_add_margin", async () => {
    engineContract.sender = aliceAddress;
    let msg = await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(60),
      leverage: toDecimals(10),
      baseAssetLimit: "0",
      takeProfit: toDecimals(17),
      stopLoss: toDecimals(0),
    });

    let engineBalance = await usdcContract.balance({
      address: engineContract.contractAddress,
    });
    expect(engineBalance.balance).toEqual(toDecimals(60));

    await engineContract.depositMargin({
      amount: toDecimals(80),
      positionId: 1,
      vamm: vammContract.contractAddress,
    });
    engineBalance = await usdcContract.balance({
      address: engineContract.contractAddress,
    });
    expect(engineBalance.balance).toEqual(toDecimals(140));

    let alicePos = await engineContract.positionWithFundingPayment({
      positionId: 1,
      vamm: vammContract.contractAddress,
    });
    expect(alicePos.margin).toEqual(toDecimals(140));

    let aliceFunding = await engineContract.balanceWithFundingPayment({
      positionId: 1,
    });
    expect(aliceFunding).toEqual(toDecimals(140));
  });

  it("test_add_margin_insufficent_balance", async () => {
    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(60),
      leverage: toDecimals(10),
      baseAssetLimit: "0",
      takeProfit: toDecimals(20),
      stopLoss: toDecimals(0),
    });

    let engineBalance = await usdcContract.balance({
      address: engineContract.contractAddress,
    });
    expect(engineBalance.balance).toEqual(toDecimals(60));
    await expect(
      engineContract.depositMargin({
        amount: toDecimals(5001),
        positionId: 1,
        vamm: vammContract.contractAddress,
      })
    ).rejects.toThrow(new GenericError("transfer failure - reply (id 9)"));
  });

  it("test_add_margin_no_open_position", async () => {
    engineContract.sender = aliceAddress;
    await expect(
      engineContract.depositMargin({
        amount: toDecimals(80),
        positionId: 1,
        vamm: vammContract.contractAddress,
      })
    ).rejects.toThrow("margined_perp::margined_engine::Position not found");
  });

  it("test_remove_margin", async () => {
    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(60),
      leverage: toDecimals(10),
      baseAssetLimit: "0",
      takeProfit: toDecimals(17),
      stopLoss: toDecimals(0),
    });

    let engineBalance = await usdcContract.balance({
      address: engineContract.contractAddress,
    });
    expect(engineBalance.balance).toEqual(toDecimals(60));

    let freeCollateral = await engineContract.freeCollateral({
      positionId: 1,
      vamm: vammContract.contractAddress,
    });
    expect(freeCollateral).toEqual(toDecimals(30));

    await engineContract.withdrawMargin({
      amount: toDecimals(20),
      positionId: 1,
      vamm: vammContract.contractAddress,
    });
    engineBalance = await usdcContract.balance({
      address: engineContract.contractAddress,
    });
    expect(engineBalance.balance).toEqual(toDecimals(40));

    let alicePosition = await engineContract.positionWithFundingPayment({
      vamm: vammContract.contractAddress,
      positionId: 1,
    });
    expect(alicePosition.margin).toEqual(toDecimals(40));
  });

  it("test_remove_margin_after_paying_funding", async () => {
    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(60),
      leverage: toDecimals(10),
      baseAssetLimit: "0",
      takeProfit: toDecimals(17),
      stopLoss: toDecimals(0),
    });

    // price changed
    await pricefeedContract.appendPrice({
      key: "ETH",
      price: toDecimals(25.5),
      timestamp: 1_000_000_000,
    });
    // move to the next funding time
    client.app.store.tx((setter) =>
      Ok(setter("time")(client.app.time + 86_400 * 1e9))
    );

    // funding payment is -3.75
    engineContract.sender = senderAddress;
    let res = await engineContract.payFunding({
      vamm: vammContract.contractAddress,
    });
    expect(res.events[5].attributes[2].value).toContain(toDecimals(3.75));

    engineContract.sender = aliceAddress;
    await engineContract.withdrawMargin({
      vamm: vammContract.contractAddress,
      positionId: 1,
      amount: toDecimals(20),
    });

    let engineBalance = await usdcContract.balance({
      address: engineContract.contractAddress,
    });
    // 60 - 20 - 3.75
    expect(engineBalance.balance).toEqual(toDecimals(36.25));

    let alicePosition = await engineContract.positionWithFundingPayment({
      positionId: 1,
      vamm: vammContract.contractAddress,
    });
    expect(alicePosition.margin).toEqual(toDecimals(36.25));
    expect(
      await engineContract.balanceWithFundingPayment({ positionId: 1 })
    ).toEqual(toDecimals(36.25));
  });

  it("test_remove_margin_insufficient_margin", async () => {
    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(60),
      leverage: toDecimals(10),
      baseAssetLimit: "0",
      takeProfit: toDecimals(17),
      stopLoss: toDecimals(0),
    });

    expect(
      await usdcContract.balance({ address: engineContract.contractAddress })
    ).toEqual<OraiswapTokenTypes.BalanceResponse>({
      balance: toDecimals(60),
    });

    await expect(
      engineContract.withdrawMargin({
        amount: toDecimals(61),
        positionId: 1,
        vamm: vammContract.contractAddress,
      })
    ).rejects.toThrow(new GenericError("Insufficient margin"));
  });

  it("test_remove_margin_unrealized_pnl_long_position_with_profit_using_spot_price", async () => {
    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(60),
      leverage: toDecimals(5),
      baseAssetLimit: "0",
      takeProfit: toDecimals(17),
      stopLoss: toDecimals(0),
    });

    // reserve 1300 : 76.92, price = 16.9
    engineContract.sender = bobAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(60),
      leverage: toDecimals(5),
      baseAssetLimit: "0",
      takeProfit: toDecimals(22),
      stopLoss: toDecimals(0),
    });
    // reserve 1600 : 62.5, price = 25.6
    engineContract.sender = aliceAddress;
    await expect(
      engineContract.withdrawMargin({
        amount: toDecimals(45.01),
        positionId: 1,
        vamm: vammContract.contractAddress,
      })
    ).rejects.toThrow(new GenericError("Insufficient collateral"));

    let freeCollateral = await engineContract.freeCollateral({
      positionId: 1,
      vamm: vammContract.contractAddress,
    });
    expect(freeCollateral).toEqual(toDecimals(45));
    await engineContract.withdrawMargin({
      amount: toDecimals(45),
      positionId: 1,
      vamm: vammContract.contractAddress,
    });
  });

  it("test_remove_margin_unrealized_pnl_long_position_with_loss_using_spot_price", async () => {
    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(60),
      leverage: toDecimals(5),
      baseAssetLimit: "0",
      takeProfit: toDecimals(18),
      stopLoss: toDecimals(0),
    });
    // reserve 1300 : 76.92, price = 16.9

    engineContract.sender = bobAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "sell",
      marginAmount: toDecimals(10),
      leverage: toDecimals(5),
      baseAssetLimit: "0",
      takeProfit: toDecimals(5),
      stopLoss: toDecimals(20),
    });
    // reserve 1250 : 80 price = 15.625

    engineContract.sender = aliceAddress;
    await expect(
      engineContract.withdrawMargin({
        vamm: vammContract.contractAddress,
        positionId: 1,
        amount: toDecimals(24.9),
      })
    ).rejects.toThrow(new GenericError("Insufficient collateral"));

    let freeCollateral = await engineContract.freeCollateral({
      positionId: 1,
      vamm: vammContract.contractAddress,
    });

    expect(Number(freeCollateral)).toEqual(24_850_746_257);
  });

  it("test_remove_margin_unrealized_pnl_short_position_with_profit_using_spot_price", async () => {
    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "sell",
      marginAmount: toDecimals(20),
      leverage: toDecimals(5),
      baseAssetLimit: "0",
      takeProfit: toDecimals(5),
      stopLoss: toDecimals(20),
    });
    // reserve 900 : 111.11, price = 8.1

    engineContract.sender = bobAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "sell",
      marginAmount: toDecimals(20),
      leverage: toDecimals(5),
      baseAssetLimit: "0",
      takeProfit: toDecimals(3),
      stopLoss: toDecimals(21),
    });
    // reserve 800 : 125, price = 6.4

    // margin: 20
    // positionSize: -11.11
    // positionNotional: 78.04
    // unrealizedPnl: 100 - 78.04 = 21.96
    // min(margin + funding, margin + funding + unrealized PnL) - position value * 5%
    // min(20, 20 + 21.96) - 78.04 * 0.05 = 16.098
    // can not remove margin > 16.098
    engineContract.sender = aliceAddress;
    await expect(
      engineContract.withdrawMargin({
        vamm: vammContract.contractAddress,
        positionId: 1,
        amount: toDecimals(16.5),
      })
    ).rejects.toThrow(new GenericError("Insufficient collateral"));

    let freeCollateral = await engineContract.freeCollateral({
      positionId: 1,
      vamm: vammContract.contractAddress,
    });
    expect(Number(freeCollateral)).toEqual(16_097_560_976);
  });

  it("test_open_position_total_fee_ten_percent", async () => {
    // 10% fee
    await vammContract.updateConfig({
      tollRatio: toDecimals(0.05),
      spreadRatio: toDecimals(0.05),
    });

    // given 240 x 2 quote asset, get 17.5 base asset
    // fee is 300 x 2 x 10% = 60
    // user needs to pay 300

    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(300),
      leverage: toDecimals(2),
      baseAssetLimit: toDecimals(17.5),
      takeProfit: toDecimals(18),
      stopLoss: toDecimals(0),
    });

    let alicePosition = await engineContract.positionWithFundingPayment({
      positionId: 1,
      vamm: vammContract.contractAddress,
    });
    expect(alicePosition.margin).toEqual(toDecimals(240));

    let engineBalance = await usdcContract.balance({
      address: engineContract.contractAddress,
    });
    expect(engineBalance.balance).toEqual(toDecimals(240));

    // 10% fee pool balance
    let feepoolBalance = await usdcContract.balance({
      address: feepoolContract.contractAddress,
    });
    expect(feepoolBalance.balance).toEqual(toDecimals(30));

    let insuranceBalance = await usdcContract.balance({
      address: insuranceFundContract.contractAddress,
    });
    expect(insuranceBalance.balance).toEqual(toDecimals(5030));
  });

  it("test_open_short_position_twice_total_fee_ten_percent", async () => {
    // 10% fee
    await vammContract.updateConfig({
      tollRatio: toDecimals(0.05),
      spreadRatio: toDecimals(0.05),
    });
    // given 50 x 2 quote asset, get 11.1 base asset
    // fee is 50 x 2 x 10% = 10
    // user needs to pay 50 + 10 = 60
    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "sell",
      marginAmount: toDecimals(50),
      leverage: toDecimals(2),
      baseAssetLimit: toDecimals(11.2),
      takeProfit: toDecimals(4),
      stopLoss: toDecimals(15),
    });
    let aliceBalance = await usdcContract.balance({ address: aliceAddress });
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "sell",
      marginAmount: toDecimals(50),
      leverage: toDecimals(2),
      baseAssetLimit: toDecimals(139),
      takeProfit: toDecimals(5),
      stopLoss: toDecimals(20),
    });

    let aliceBalanceLost =
      Number(aliceBalance.balance) -
      Number((await usdcContract.balance({ address: aliceAddress })).balance);
    expect(aliceBalanceLost.toString()).toEqual(toDecimals(50));
  });

  it("test_open_and_close_position_fee_ten_percent", async () => {
    await vammContract.updateConfig({
      tollRatio: toDecimals(0.05),
      spreadRatio: toDecimals(0.05),
    });

    // given 50 x 2 quote asset, get 11.1 base asset
    // fee is 50 x 2 x 10% = 10
    // user needs to pay 50 + 10 = 60
    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(300),
      leverage: toDecimals(2),
      baseAssetLimit: toDecimals(17.5),
      takeProfit: toDecimals(18),
      stopLoss: toDecimals(0),
    });

    await engineContract.closePosition({
      vamm: vammContract.contractAddress,
      positionId: 1,
      quoteAssetLimit: "0",
    });

    let engineBalance = await usdcContract.balance({
      address: engineContract.contractAddress,
    });
    expect(engineBalance.balance).toEqual("7");

    let feepoolBalance = await usdcContract.balance({
      address: feepoolContract.contractAddress,
    });
    expect(feepoolBalance.balance).toEqual(toDecimals(60));

    let insuranceBalance = await usdcContract.balance({
      address: insuranceFundContract.contractAddress,
    });
    expect(insuranceBalance.balance).toEqual(toDecimals(5060));
  });

  it("test_has_spread_no_toll", async () => {
    await vammContract.updateConfig({
      tollRatio: toDecimals(0),
      spreadRatio: toDecimals(0.1),
    });
    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(300),
      leverage: toDecimals(2),
      baseAssetLimit: toDecimals(0),
      takeProfit: toDecimals(18),
      stopLoss: toDecimals(8),
    });

    // toll ratio = 0 => no fee pool balance
    let feepoolBalance = await usdcContract.balance({
      address: feepoolContract.contractAddress,
    });
    expect(feepoolBalance.balance).toEqual(toDecimals(0));

    let insuranceBalance = await usdcContract.balance({
      address: insuranceFundContract.contractAddress,
    });
    expect(insuranceBalance.balance).toEqual(toDecimals(5060));
  });

  it("test_force_error_open_position_exceeds_fluctuation_limit", async () => {
    usdcContract.sender = aliceAddress;
    await usdcContract.decreaseAllowance({
      spender: engineContract.contractAddress,
      amount: toDecimals(1900),
    });

    await vammContract.updateConfig({ fluctuationLimitRatio: toDecimals(0.2) });

    // alice pays 20 margin * 5x long quote when 9.0909091 base
    // AMM after: 1100 : 90.9090909, price: 12.1000000012
    engineContract.sender = aliceAddress;
    await expect(
      engineContract.openPosition({
        vamm: vammContract.contractAddress,
        side: "buy",
        marginAmount: toDecimals(20),
        leverage: toDecimals(5),
        baseAssetLimit: toDecimals(0),
        takeProfit: toDecimals(15),
        stopLoss: toDecimals(8),
      })
    ).rejects.toThrow(new GenericError("open position failure - reply (id 1)"));
  });

  it("test_margin_engine_should_have_enough_balance_after_close_position", async () => {
    usdcContract.sender = aliceAddress;
    await usdcContract.decreaseAllowance({
      spender: engineContract.contractAddress,
      amount: toDecimals(1900),
    });

    usdcContract.sender = bobAddress;
    await usdcContract.decreaseAllowance({
      spender: engineContract.contractAddress,
      amount: toDecimals(1800),
    });

    // AMM after: 900 : 111.1111111111
    engineContract.sender = bobAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "sell",
      marginAmount: toDecimals(20),
      leverage: toDecimals(5),
      baseAssetLimit: "0",
      takeProfit: toDecimals(6),
      stopLoss: toDecimals(20),
    });

    // AMM after: 800 : 125
    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "sell",
      marginAmount: toDecimals(25),
      leverage: toDecimals(4),
      baseAssetLimit: "0",
      takeProfit: toDecimals(4),
      stopLoss: toDecimals(17),
    });

    // 20(bob's margin) + 25(alice's margin) = 45
    let engineBalance = await usdcContract.balance({
      address: engineContract.contractAddress,
    });
    expect(engineBalance.balance).toEqual(toDecimals(45));

    // when bob close his position (11.11)
    // AMM after: 878.0487804877 : 113.8888888889
    // Bob's PnL = 21.951219512195121950
    // need to return Bob's margin 20 and PnL 21.951 = 41.951
    // clearingHouse balance: 45 - 41.951 = 3.048...
    engineContract.sender = bobAddress;
    await engineContract.closePosition({
      vamm: vammContract.contractAddress,
      positionId: 1,
      quoteAssetLimit: "0",
    });

    let insuranceBalance = await usdcContract.balance({
      address: insuranceFundContract.contractAddress,
    });
    expect(insuranceBalance.balance).toEqual(toDecimals(5000));

    engineBalance = await usdcContract.balance({
      address: engineContract.contractAddress,
    });
    expect(engineBalance.balance).toEqual("3048780494");
  });

  it("test_margin_engine_does_not_have_enough_balance_after_close_position", async () => {
    usdcContract.sender = aliceAddress;
    await usdcContract.decreaseAllowance({
      spender: engineContract.contractAddress,
      amount: toDecimals(1900),
    });

    usdcContract.sender = bobAddress;
    await usdcContract.decreaseAllowance({
      spender: engineContract.contractAddress,
      amount: toDecimals(1800),
    });
    // AMM after: 900 : 111.1111111111
    engineContract.sender = bobAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "sell",
      marginAmount: toDecimals(20),
      leverage: toDecimals(5),
      baseAssetLimit: "0",
      takeProfit: toDecimals(7),
      stopLoss: toDecimals(20),
    });

    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "sell",
      marginAmount: toDecimals(20),
      leverage: toDecimals(5),
      baseAssetLimit: "0",
      takeProfit: toDecimals(5),
      stopLoss: toDecimals(17),
    });

    // 20(bob's margin) + 25(alice's margin) = 40
    let engineBalance = await usdcContract.balance({
      address: engineContract.contractAddress,
    });
    expect(engineBalance.balance).toEqual(toDecimals(40));

    // when bob close his position (11.11)
    // AMM after: 878.0487804877 : 113.8888888889
    // Bob's PnL = 21.951219512195121950
    // need to return Bob's margin 20 and PnL 21.951 = 41.951
    // clearingHouse balance: 40 - 41.951 = -1.95...
    engineContract.sender = bobAddress;
    await engineContract.closePosition({
      vamm: vammContract.contractAddress,
      positionId: 1,
      quoteAssetLimit: "0",
    });
    let insuranceBalance = await usdcContract.balance({
      address: insuranceFundContract.contractAddress,
    });
    expect(insuranceBalance.balance).toEqual("4998048780494");

    engineBalance = await usdcContract.balance({
      address: engineContract.contractAddress,
    });
    expect(engineBalance.balance).toEqual("0");
  });

  it("test_get_margin_ratio", async () => {
    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(25),
      leverage: toDecimals(10),
      baseAssetLimit: "0",
      takeProfit: toDecimals(15),
      stopLoss: toDecimals(9),
    });

    let marginRatio = await engineContract.marginRatio({
      positionId: 1,
      vamm: vammContract.contractAddress,
    });
    expect(marginRatio).toEqual(toDecimals(0.1));
  });

  it("test_get_margin_ratio_long", async () => {
    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(25),
      leverage: toDecimals(10),
      baseAssetLimit: "0",
      takeProfit: toDecimals(15),
      stopLoss: toDecimals(9),
    });

    let position = await engineContract.position({
      positionId: 1,
      vamm: vammContract.contractAddress,
    });
    expect(position.size).toEqual(toDecimals(20));

    engineContract.sender = bobAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "sell",
      marginAmount: toDecimals(15),
      leverage: toDecimals(10),
      baseAssetLimit: "0",
      takeProfit: toDecimals(9),
      stopLoss: toDecimals(17),
    });
    position = await engineContract.position({
      positionId: 2,
      vamm: vammContract.contractAddress,
    });
    expect(Number(position.size)).toEqual(-10_909_090_910);

    let marginRatio = await engineContract.marginRatio({
      positionId: 1,
      vamm: vammContract.contractAddress,
    });
    expect(Number(marginRatio)).toEqual(-134_297_520);
  });

  it("test_get_margin_ratio_short", async () => {
    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "sell",
      marginAmount: toDecimals(25),
      leverage: toDecimals(10),
      baseAssetLimit: "0",
      takeProfit: toDecimals(6),
      stopLoss: toDecimals(20),
    });

    engineContract.sender = bobAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(15),
      leverage: toDecimals(10),
      baseAssetLimit: "0",
      takeProfit: toDecimals(15),
      stopLoss: toDecimals(4),
    });

    let marginRatio = await engineContract.marginRatio({
      positionId: 1,
      vamm: vammContract.contractAddress,
    });
    expect(Number(marginRatio)).toEqual(-287_037_037);
  });

  it("test_get_margin_higher_twap", async () => {
    // moves block forward 15 secs timestamp
    client.app.store.tx((setter) =>
      Ok(setter("time")(client.app.time + 15 * 1e9))
    );
    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(25),
      leverage: toDecimals(10),
      baseAssetLimit: "0",
      takeProfit: toDecimals(15),
      stopLoss: toDecimals(9),
    });

    client.app.store.tx((setter) =>
      Ok(setter("time")(client.app.time + 15 * 62 * 1e9))
    );

    engineContract.sender = bobAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "sell",
      marginAmount: toDecimals(15),
      leverage: toDecimals(10),
      baseAssetLimit: "0",
      takeProfit: toDecimals(5),
      stopLoss: toDecimals(26),
    });

    // moves block forward 15 secs timestamp
    client.app.store.tx((setter) =>
      Ok(setter("time")(client.app.time + 15 * 1e9))
    );

    let marginRatio = await engineContract.marginRatio({
      positionId: 1,
      vamm: vammContract.contractAddress,
    });

    expect(Number(marginRatio)).toEqual(96_890_936);
  });

  it("test_verify_margin_ratio_funding_payment_positive", async () => {
    client.app.store.tx((setter) =>
      Ok(setter("time")(client.app.time + 15 * 1e9))
    );
    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(25),
      leverage: toDecimals(10),
      baseAssetLimit: "0",
      takeProfit: toDecimals(15),
      stopLoss: toDecimals(9),
    });
    await pricefeedContract.appendPrice({
      key: "ETH",
      price: toDecimals(15.5),
      timestamp: 1_000_000_000,
    });
    client.app.store.tx((setter) =>
      Ok(setter("time")(client.app.time + 86_400 * 1e9))
    );

    // relayer can now call pay funding
    await engineContract.payFunding({ vamm: vammContract.contractAddress });
    const premiumFraction = await engineContract.cumulativePremiumFraction({
      vamm: vammContract.contractAddress,
    });

    expect(premiumFraction).toEqual(toDecimals(0.125));
  });

  it("test_verify_margin_ratio_funding_payment_negative", async () => {
    client.app.store.tx((setter) =>
      Ok(setter("time")(client.app.time + 15 * 1e9))
    );
    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(25),
      leverage: toDecimals(10),
      baseAssetLimit: "0",
      takeProfit: toDecimals(15),
      stopLoss: toDecimals(9),
    });
    await pricefeedContract.appendPrice({
      key: "ETH",
      price: toDecimals(15.7),
      timestamp: 1_000_000_000,
    });
    client.app.store.tx((setter) =>
      Ok(setter("time")(client.app.time + 86_400 * 1e9))
    );

    // relayer can now call pay funding
    await engineContract.payFunding({ vamm: vammContract.contractAddress });
    const premiumFraction = await engineContract.cumulativePremiumFraction({
      vamm: vammContract.contractAddress,
    });

    expect(premiumFraction).toEqual(toDecimals(-0.075));

    // marginRatio = (margin + funding payment + unrealized Pnl) / openNotional
    // funding payment: 20 * 7.5% = 1.5
    // position notional: 250
    // margin ratio: (25 + 1.5) / 250 =  0.106

    const marginRatio = await engineContract.marginRatio({
      positionId: 1,
      vamm: vammContract.contractAddress,
    });
    expect(marginRatio).toEqual(toDecimals(0.106));
  });

  it("test_liquidator_can_open_position_and_liquidate_in_next_block", async () => {
    const timestamp = Math.round(client.app.time / 1e9);
    await pricefeedContract.appendPrice({
      key: "ETH",
      price: toDecimals(10),
      timestamp,
    });
    client.app.store.tx((setter) =>
      Ok(setter("time")(client.app.time + 900 * 1e9))
    );

    await engineContract.updateConfig({
      initialMarginRatio: toDecimals(0.1),
      maintenanceMarginRatio: toDecimals(0.1),
      partialLiquidationRatio: toDecimals(0.25),
      liquidationFee: toDecimals(0.025),
    });

    // reduce the allowance

    usdcContract.sender = aliceAddress;
    await usdcContract.decreaseAllowance({
      amount: toDecimals(1000),
      spender: engineContract.contractAddress,
    });

    usdcContract.sender = bobAddress;
    await usdcContract.decreaseAllowance({
      amount: toDecimals(1000),
      spender: engineContract.contractAddress,
    });

    // mint funds for carol
    usdcContract.sender = senderAddress;
    await usdcContract.mint({
      amount: toDecimals(1000),
      recipient: carolAddress,
    });

    // set allowance for carol
    usdcContract.sender = carolAddress;
    await usdcContract.increaseAllowance({
      amount: toDecimals(1000),
      spender: engineContract.contractAddress,
    });

    engineContract.sender = bobAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(20),
      leverage: toDecimals(5),
      baseAssetLimit: toDecimals(9.09),
      takeProfit: toDecimals(18),
      stopLoss: toDecimals(0),
    });

    client.app.store.tx((setter) =>
      Ok(setter("time")(client.app.time + 15 * 1e9))
    );

    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "buy",
      marginAmount: toDecimals(20),
      leverage: toDecimals(5),
      baseAssetLimit: toDecimals(0),
      takeProfit: toDecimals(16),
      stopLoss: toDecimals(0),
    });

    client.app.store.tx((setter) =>
      Ok(setter("time")(client.app.time + 15 * 1e9))
    );

    engineContract.sender = bobAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "sell",
      marginAmount: toDecimals(20),
      leverage: toDecimals(5),
      baseAssetLimit: toDecimals(0),
      takeProfit: toDecimals(10),
      stopLoss: toDecimals(25),
    });

    client.app.store.tx((setter) =>
      Ok(setter("time")(client.app.time + 15 * 1e9))
    );

    engineContract.sender = carolAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: "sell",
      marginAmount: toDecimals(20),
      leverage: toDecimals(5),
      baseAssetLimit: toDecimals(0),
      takeProfit: toDecimals(10),
      stopLoss: toDecimals(20),
    });

    let price = await vammContract.spotPrice();
    await pricefeedContract.appendPrice({ key: "ETH", price, timestamp });

    engineContract.sender = carolAddress;
    let res = await engineContract.liquidate({
      quoteAssetLimit: "0",
      positionId: 2,
      vamm: vammContract.contractAddress,
    });
    console.log("liquidate gasUsed:", res.gasUsed);
    expect(res.events[5].attributes[1].value).toEqual(
      "partial_liquidation_reply"
    );
  });
});
