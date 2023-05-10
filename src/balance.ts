import { ApiPromise, WsProvider } from "@polkadot/api";
import { BN } from "@polkadot/util";
import type { Probot } from "probot";

import { getChainConfig } from "./chain-config";
import { balanceGauge } from "./metrics";
import { TipNetwork } from "./types";

/**
 * The function will update the balances of the tip bot on all networks.
 * It will skip the local, development networks.
 * This is intended to be executed upon startup of the bot.
 * After that, the balances (including local ones) will be updated after a tip is executed.
 */
export const updateAllBalances = async (tipBotAddress: string, log: Probot["log"]): Promise<void> => {
  const networks: TipNetwork[] = ["kusama", "polkadot"];
  for (const network of networks) {
    log.info(`Checking tip bot balance on ${network}`);
    try {
      await updateBalance({ network, tipBotAddress });
    } catch (e) {
      log.info(`Failed to check balance on ${network}`, e.message);
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
