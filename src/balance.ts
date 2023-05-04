import { ApiPromise, WsProvider } from "@polkadot/api";
import { BN } from "@polkadot/util";

import { getChainConfig } from "./chain-config";
import { balanceGauge } from "./metrics";
import { TipNetwork } from "./types";
import type { Probot } from "probot";

export const updateAllBalances = async (tipBotAddress: string, log: Probot["log"]): Promise<void> => {
  const networks: TipNetwork[] = ["localpolkadot", "localkusama", "kusama", "polkadot"];
  for (const network of networks) {
    log.info(`Checking tip bot balance on ${network}`)
    try {
      await updateBalance({ network, tipBotAddress });
    } catch(e) {
      log.info(`Failed to check balance on ${network}`, e.message)
    }
  }
};

export const updateBalance = async (opts: { network: TipNetwork; tipBotAddress: string }): Promise<void> => {
  const { network, tipBotAddress } = opts;
  const config = getChainConfig(network);

  const provider = new WsProvider(config.providerEndpoint);
  const api = await ApiPromise.create({ provider, throwOnConnect: true });
  await api.isReady;

  const { data: balances } = await api.query.system.account(tipBotAddress);
  const balance = balances.free
    .toBn()
    .div(new BN(10 ** config.decimals))
    .toNumber();
  balanceGauge.set({ network }, balance);
};
