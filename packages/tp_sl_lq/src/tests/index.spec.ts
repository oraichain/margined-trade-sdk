import { GenericError, SimulateCosmWasmClient } from '@oraichain/cw-simulate';

import {
  MarginedEngineClient,
  MarginedEngineTypes,
  MarginedVammClient,
  MarginedPricefeedClient,
  MarginedInsuranceFundClient,
  MarginedFeePoolClient,
  SigningCosmWasmClient
} from '@oraichain/oraimargin-contracts-sdk';
import { OraiswapTokenClient, OraiswapTokenTypes } from '@oraichain/oraidex-contracts-sdk';
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
  carolAddress
} from './common';

import { triggerTpSl } from "../index"
import { Ok } from 'ts-results';
import { UserWallet } from '@oraichain/oraimargin-common';

const client = new SimulateCosmWasmClient({
  chainId: 'Oraichain',
  bech32Prefix: 'orai',
  metering: process.env.METERING === 'true'
});

describe('perpetual-engine', () => {
  let insuranceFundContract: MarginedInsuranceFundClient;
  let usdcContract: OraiswapTokenClient;
  let engineContract: MarginedEngineClient;
  let pricefeedContract: MarginedPricefeedClient;
  let feepoolContract: MarginedFeePoolClient;
  let vammContract: MarginedVammClient;
  let sender: UserWallet;
  beforeEach(async () => {
    [senderAddress, bobAddress].forEach((address) =>
      client.app.bank.setBalance(address, [{ denom: 'orai', amount: '5000000000' }])
    );

    sender = { client, address: senderAddress };
    
    [pricefeedContract, feepoolContract, usdcContract] = await Promise.all([
      deployPricefeed(client),
      deployFeePool(client),
      deployToken(client, {
        symbol: 'USDC',
        decimals: 9,
        name: 'USDC token',
        initial_balances: [
          { address: bobAddress, amount: toDecimals(5000) },
          { address: aliceAddress, amount: toDecimals(5000) }
        ]
      })
    ]);

    engineContract = await deployEngine(client, {
      token: usdcContract.contractAddress,
      fee_pool: feepoolContract.contractAddress,
      initial_margin_ratio: toDecimals(0.05),
      maintenance_margin_ratio: toDecimals(0.05),
      tp_sl_spread: toDecimals(0.05),
      liquidation_fee: toDecimals(0.05)
    });
    insuranceFundContract = await deployInsuranceFund(client, { engine: engineContract.contractAddress });
    await engineContract.updateConfig({
      insuranceFund: insuranceFundContract.contractAddress
    });

    // mint insurance fund contract balance
    await usdcContract.mint({ recipient: insuranceFundContract.contractAddress, amount: toDecimals(5000) });

    vammContract = await deployVamm(client, {
      pricefeed: pricefeedContract.contractAddress,
      // margin_engine: engineContract.contractAddress,
      insurance_fund: insuranceFundContract.contractAddress,
      base_asset_reserve: toDecimals(100),
      quote_asset_reserve: toDecimals(1000),
      toll_ratio: '0',
      spread_ratio: '0',
      fluctuation_limit_ratio: '0',
      funding_period: 86_400, // 1 day
      decimals: 9
    });

    await vammContract.updateConfig({ marginEngine: engineContract.contractAddress });

    await vammContract.setOpen({ open: true });

    // register vamm
    await insuranceFundContract.addVamm({ vamm: vammContract.contractAddress });

    // append a price to the pricefeed
    await pricefeedContract.appendPrice({ key: 'ETH', price: toDecimals(10), timestamp: 1e9 });

    // increase allowance for engine contract
    await Promise.all(
      [bobAddress, aliceAddress].map((addr) => {
        usdcContract.sender = addr;
        return usdcContract.increaseAllowance({ amount: toDecimals(2000), spender: engineContract.contractAddress });
      })
    );
  });

  it('test_instantiation', async () => {
    let res = await engineContract.config();
    expect(res).toEqual<MarginedEngineTypes.ConfigResponse>({
      owner: senderAddress,
      insurance_fund: insuranceFundContract.contractAddress,
      fee_pool: feepoolContract.contractAddress,
      eligible_collateral: {
        token: { contract_addr: usdcContract.contractAddress }
      },
      decimals: toDecimals(1),
      initial_margin_ratio: '50000000',
      maintenance_margin_ratio: '50000000',
      partial_liquidation_ratio: '0',
      tp_sl_spread: '50000000',
      liquidation_fee: '50000000'
    });
  });

  it('test_take_profit', async () => {
    engineContract.sender = aliceAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: 'buy',
      marginAmount: toDecimals(60),
      leverage: toDecimals(10),
      baseAssetLimit: toDecimals(0),
      takeProfit: toDecimals(20),
      stopLoss: toDecimals(14)
    });
    const alicePosition = await engineContract.position({
      positionId: 1,
      vamm: vammContract.contractAddress
    });

    expect(alicePosition.margin).toEqual(toDecimals(60));
    expect(alicePosition.take_profit).toEqual(toDecimals(20));
    expect(alicePosition.stop_loss).toEqual(toDecimals(14));

    const spotPrice = await vammContract.spotPrice();
    expect(spotPrice).toEqual(toDecimals(25.6));


    engineContract.sender = bobAddress;
    await engineContract.openPosition({
      vamm: vammContract.contractAddress,
      side: 'sell',
      marginAmount: toDecimals(6),
      leverage: toDecimals(8),
      baseAssetLimit: toDecimals(0),
      takeProfit: toDecimals(20),
      stopLoss: toDecimals(28)
    });
    const bobPosition = await engineContract.position({
      positionId: 2,
      vamm: vammContract.contractAddress
    });
    
    expect(bobPosition.margin).toEqual(toDecimals(6));
    expect(bobPosition.take_profit).toEqual(toDecimals(20));
    expect(bobPosition.stop_loss).toEqual(toDecimals(28));

    let msgs = await triggerTpSl(sender, engineContract.contractAddress, vammContract.contractAddress, "buy");
    console.log({ msgs });
    
    
  });

});
