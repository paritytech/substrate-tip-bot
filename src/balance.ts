import { ApiPromise, WsProvider } from "@polkadot/api";
import { BN } from "@polkadot/util";

import { getChainConfig } from "./chain-config";
import { balanceGauge } from "./metrics";
import { TipNetwork } from "./types";

export const updateAllBalances = async (tipBotAddress: string): Promise<void> => {
  const networks: TipNetwork[] = ["localpolkadot", "localkusama", "kusama", "polkadot"];
  for (const network of networks) {
    await updateBalance({ network, tipBotAddress });
  }
};

export const updateBalance = async (opts: { network: TipNetwork; tipBotAddress: string }): Promise<void> => {
  const { network, tipBotAddress } = opts;
  const config = getChainConfig(network);

  const provider = new WsProvider(config.providerEndpoint);
  const api = await ApiPromise.create({ provider });
  await api.isReady;

  const { data: balances } = await api.query.system.account(tipBotAddress);
  const balance = balances.free
    .toBn()
    .div(new BN(10 ** config.decimals))
    .toNumber();
  balanceGauge.set({ network }, balance);
};
