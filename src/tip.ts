import { ApiPromise, WsProvider } from "@polkadot/api";

import { getChainConfig } from "./chain-config";
import { tipOpenGov } from "./tip-opengov";
import { tipTreasury } from "./tip-treasury";
import { State, TipRequest, TipResult } from "./types";

/* TODO add some kind of timeout then return an error
   TODO Unit tests */
export async function tipUser(state: State, tipRequest: TipRequest): Promise<TipResult> {
  const { bot, botTipAccount } = state;
  const { providerEndpoint, tipUrl } = getChainConfig(tipRequest);
  const provider = new WsProvider(providerEndpoint)

  const api = await ApiPromise.create({ provider });
  await api.isReady;

  // Get general information about the node we are connected to
  const [chain, nodeName, nodeVersion] = await Promise.all([
    api.rpc.system.chain(),
    api.rpc.system.name(),
    api.rpc.system.version(),
  ]);

  bot.log(`You are connected to chain ${chain.toString()} using ${nodeName.toString()} v${nodeVersion.toString()}`);

  try {
    switch (tipRequest.tip.type) {
      case "treasury":
        await tipTreasury({ state, api, tipRequest, botTipAccount });
        break;
      case "opengov":
        await tipOpenGov({ state, api, tipRequest, botTipAccount });
        break;
      default: {
        const exhaustivenessCheck: never = tipRequest.tip.type;
        throw new Error(
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          `Invalid tip type: "${exhaustivenessCheck}"`,
        );
      }
    }
  } catch (e) {
    bot.log.error(e.message);
    return { success: false, tipUrl };
  } finally {
    await api.disconnect();
    await provider.disconnect()
  }

  return { success: true, tipUrl };
}
