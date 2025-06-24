import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/node";
import type { Probot } from "probot";

import { getChainConfig, getDescriptor, getWsUrl } from "./chain-config";
import { balanceGauge } from "./metrics";
import { TipNetwork } from "./types";

/**
 * The function will update the balances of the tip bot on all networks.
 * It will skip the local, development networks.
 * This is intended to be executed upon startup of the bot.
 * After that, the balances (including local ones) will be updated after a tip is executed.
 */
export const updateAllBalances = async (tipBotAddress: string, log: Probot["log"]): Promise<void> => {
  const networks: TipNetwork[] = ["kusama", "polkadot", "rococo", "westend"];
  for (const network of networks) {
    log.info(`Checking tip bot balance for on ${network}`);
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

  const jsonRpcProvider = getWsProvider(getWsUrl(network));
  const client = createClient(jsonRpcProvider);
  const api = client.getTypedApi(getDescriptor(network));

  try {
    const { data: balances } = await api.query.System.Account.getValue(tipBotAddress);
    const balance = Number(balances.free / 10n ** BigInt(config.decimals));
    balanceGauge.set({ network }, balance);
  } finally {
    client.destroy();
  }
};
