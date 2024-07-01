import { BN } from "@polkadot/util";
import { polkadot } from "@polkadot-api/descriptors";
import { createClient, TypedApi } from "polkadot-api";
import { WebSocketProvider } from "polkadot-api/ws-provider/node";
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
  const networks: TipNetwork[] = ["kusama", "polkadot", "rococo", "westend"];
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

  const jsonRpcProvider = WebSocketProvider(config.providerEndpoint);
  const client = createClient(jsonRpcProvider);

  // Check that it works
  await client.getFinalizedBlock();

  // Set up the types
  const polkadotClient: TypedApi<typeof polkadot> = client.getTypedApi(polkadot);

  try {
    const { data: balances } = await polkadotClient.query.System.Account.getValue(tipBotAddress);
    const balance = Number(balances.free / 10n ** BigInt(config.decimals));
    balanceGauge.set({ network }, balance);
  } finally {
    client.destroy();
  }
};
