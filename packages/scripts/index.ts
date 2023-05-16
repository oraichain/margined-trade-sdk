import 'dotenv/config.js';
import { GasPrice } from '@cosmjs/stargate';
import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { mainnet } from './configs';
import { deployContract } from '@oraichain/oraimargin-contracts-build';

// consts
const config = {
  chainId: process.env.CHAIN_ID || 'Oraichain',
  rpcEndpoint: process.env.RPC || 'https://rpc.orai.io',
  prefix: 'orai'
};

// main
async function main() {
  const mnemonic = process.env.MNEMONIC;

  // just check mnemonic has actually been defined
  if (mnemonic === null || mnemonic === undefined) {
    const message = `mnemonic undefined`;

    throw new Error(message);
  }

  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: config.prefix
  });

  const client = await SigningCosmWasmClient.connectWithSigner(config.rpcEndpoint, wallet, {
    gasPrice: GasPrice.fromString('0.002orai'),
    prefix: config.prefix
  });

  const [account] = await wallet.getAccounts();

  console.log(`Wallet address from seed: ${account.address}`);

  ///
  /// Deploy Fee Pool Contract
  ///
  console.log('Deploying Fee Pool...');
  const { contractAddress: feePoolContractAddress } = await deployContract(client, account.address, mainnet.feepoolInitMsg, 'margined fee pool', 'margined_fee_pool');
  console.log('Fee Pool Contract Address: ' + feePoolContractAddress);

  ///
  /// Deploy Insurance Fund Contract
  ///
  console.log('Deploying Insurance Fund...');
  const { contractAddress: insuranceFundContractAddress } = await deployContract(client, account.address, mainnet.insuranceFundInitMsg, 'margined insurance fund', 'margined_insurance_fund');
  console.log('Insurance Fund Contract Address: ' + insuranceFundContractAddress);

  ///
  /// Deploy Mock PriceFeed Contract
  ///
  console.log('Deploying Mock PriceFeed...');
  const { contractAddress: priceFeedAddress } = await deployContract(client, account.address, mainnet.priceFeedInitMsg, 'margined pricefeed', 'margined_pricefeed');
  console.log('Mock PriceFeed Address: ' + priceFeedAddress);

  ///
  /// Deploy ETH:UST vAMM Contract
  ///
  console.log('Deploying ETH:UST vAMM...');
  mainnet.vammInitMsg.pricefeed = priceFeedAddress;
  const { contractAddress: vammContractAddress } = await deployContract(client, account.address, mainnet.vammInitMsg, 'margined vamm', 'margined_vamm');
  console.log('ETH:UST vAMM Address: ' + vammContractAddress);

  ///
  /// Deploy Margin Engine Contract
  ///

  console.log('Deploy Margin Engine...');
  mainnet.engineInitMsg.insurance_fund = insuranceFundContractAddress;
  mainnet.engineInitMsg.fee_pool = feePoolContractAddress;
  mainnet.engineInitMsg.eligible_collateral = 'orai';
  const { contractAddress: marginEngineContractAddress } = await deployContract(client, account.address, mainnet.engineInitMsg, 'margined engine', 'margined_engine');
  console.log('Margin Engine Address: ' + marginEngineContractAddress);

  // Define Margin engine address in vAMM
  console.log('Set Margin Engine in vAMM...');
  await client.execute(
    account.address,
    vammContractAddress,
    {
      update_config: {
        margin_engine: marginEngineContractAddress
      }
    },
    'auto'
  );
  console.log('Margin Engine set in vAMM');

  ///
  /// Define the token address in the Margin Engine
  ///
  console.log('Set Eligible Collateral in Margin Engine...');
  await client.execute(
    account.address,
    marginEngineContractAddress,
    {
      update_config: {
        eligible_collateral: mainnet.cw20_tokens.usdt
      }
    },
    'auto'
  );
  console.log('Margin Engine set in vAMM');

  ///
  /// Register vAMM in Insurance Fund
  ///
  console.log('Register vAMM in Insurance Fund...');
  await client.execute(
    account.address,
    insuranceFundContractAddress,
    {
      add_vamm: {
        vamm: vammContractAddress
      }
    },
    'auto'
  );
  console.log('vAMM registered');

  ///
  ///
  /// Define Margin Engine as Insurance Fund Beneficiary
  ///
  ///
  console.log('Define Margin Engine as Insurance Fund Beneficiary...');
  await client.execute(
    account.address,
    insuranceFundContractAddress,
    {
      update_config: {
        beneficiary: marginEngineContractAddress
      }
    },
    'auto'
  );
  console.log('Margin Engine set as beneficiary');

  ///
  /// Set vAMM Open
  ///
  console.log('Set vAMM Open...');
  await client.execute(
    account.address,
    vammContractAddress,
    {
      set_open: {
        open: true
      }
    },
    'auto'
  );
  console.log('vAMM set to open');

  ///
  /// Query vAMM state
  ///
  console.log('Querying vAMM state...');
  let state = await client.queryContractSmart(vammContractAddress, {
    state: {}
  });
  console.log('vAMM state:\n', state);
}

main().catch(console.log);
