import { ApiPromise, WsProvider } from "@polkadot/api";

import { getChainConfig } from "./chain-config";
import { tipOpenGov } from "./tip-opengov";
import { State, TipRequest, TipResult } from "./types";

/* TODO add some kind of timeout then return an error
   TODO Unit tests */
export async function tipUser(state: State, tipRequest: TipRequest): Promise<TipResult> {
  const { bot } = state;
  const chainConfig = getChainConfig(tipRequest.contributor.account.network);
  const provider = new WsProvider(chainConfig.providerEndpoint);

  const api = await ApiPromise.create({ provider, throwOnConnect: true });
  await api.isReadyOrError;

  // Get general information about the node we are connected to
  const [chain, nodeName, nodeVersion] = await Promise.all([
    api.rpc.system.chain(),
    api.rpc.system.name(),
    api.rpc.system.version(),
  ]);

  bot.log(`You are connected to chain ${chain.toString()} using ${nodeName.toString()} v${nodeVersion.toString()}`);

  try {
    return await tipOpenGov({ state, api, tipRequest });
  } catch (e) {
    bot.log.error(e.message);
    return { success: false };
  } finally {
    await api.disconnect();
    await provider.disconnect();
  }
}
