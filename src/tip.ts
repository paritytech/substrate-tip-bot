import { ApiPromise, WsProvider } from "@polkadot/api";

import { getChainConfig } from "./chain-config";
import { tipOpenGov, tipOpenGovReferendumExtrinsic } from "./tip-opengov";
import { State, TipRequest, TipResult } from "./types";

async function createApi(state: State, tipRequest: TipRequest) {
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

  return { api, provider };
}

/**
 * Tips the user using the Bot account.
 * The bot will send the referendum creation transaction itself and pay for the fees.
 */
export async function tipUser(state: State, tipRequest: TipRequest): Promise<TipResult> {
  const { provider, api } = await createApi(state, tipRequest);

  try {
    return await tipOpenGov({ state, api, tipRequest });
  } finally {
    await api.disconnect();
    await provider.disconnect();
  }
}

/**
 * Prepare a referendum extrinsic, but do not actually send it to the chain.
 * Create a transaction creation link for the user.
 */
export async function tipUserLink(
  state: State,
  tipRequest: TipRequest,
): Promise<{ success: false; errorMessage: string } | { success: true; extrinsicCreationLink: string }> {
  const { provider, api } = await createApi(state, tipRequest);

  try {
    const preparedExtrinsic = tipOpenGovReferendumExtrinsic({ api, tipRequest });
    if (!preparedExtrinsic.success) {
      return preparedExtrinsic;
    }
    const transactionHex = preparedExtrinsic.referendumExtrinsic.method.toHex();
    const chainConfig = getChainConfig(tipRequest.contributor.account.network);
    const polkadotAppsUrl = `https://polkadot.js.org/apps/?rpc=${encodeURIComponent(chainConfig.providerEndpoint)}#/`;
    const extrinsicCreationLink = `${polkadotAppsUrl}extrinsics/decode/${transactionHex}`;
    return { success: true, extrinsicCreationLink };
  } finally {
    await api.disconnect();
    await provider.disconnect();
  }
}
