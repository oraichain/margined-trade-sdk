import { DownloadState, SimulateCosmWasmClient } from '@oraichain/cw-simulate';
import { MarginedEngineQueryClient } from '@oraichain/oraimargin-contracts-sdk';

const SENDER = 'orai1fs25usz65tsryf0f8d5cpfmqgr0xwup4kjqpa0';
const contracts = {
  engineAddr: 'orai1wrkchuss9wtph4mxrzqksfrulj7hsl89z0048hg8l7hcglse5rxqea2qnr',
  insuranceFundAddr: 'orai1l2z27tt0aq2vd2jr0g7vhy8975t6u3sly8pqay9ek3dctgpmkyrqju3dek',
  feePoolAddr: 'orai10q37uaq728y93u03dw6jzcxqqc36cu4q08k0c4wmhj4egqch69zstja6xu',
  injusdcVamm: 'orai1z36626k3s5k6nl0usn8543v67edn0rpgxnpr58xvr0luvdxu55cs96dv73'
};

const downloadState = new DownloadState('https://lcd.orai.io', 'data');

// downloadState.saveState(injusdcVamm);

const client = new SimulateCosmWasmClient({
  chainId: 'Oraichain',
  bech32Prefix: 'orai'
});

for (const [label, contractAddress] of Object.entries(contracts)) {
  await downloadState.loadState(client, SENDER, contractAddress, label);
}

const contract = new MarginedEngineQueryClient(client, contracts.engineAddr);

const positions = await contract.positions({ filter: 'none', vamm: contracts.injusdcVamm });
for (const position of positions) {
  const pos = await contract.positionWithFundingPayment({ positionId: position.position_id, vamm: contracts.injusdcVamm });
  console.log(pos);
}
