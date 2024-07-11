import { polkadot } from "@polkadot-api/descriptors";
import { getPolkadotSigner } from "@polkadot-api/signer";
import { createClient, PolkadotClient, TypedApi } from "polkadot-api";
import { WebSocketProvider } from "polkadot-api/ws-provider/node";

import { getChainConfig } from "./chain-config";
import { tipOpenGov, tipOpenGovReferendumExtrinsic } from "./tip-opengov";
import { State, TipRequest, TipResult } from "./types";

export type API = TypedApi<typeof polkadot>;

async function createApi(state: State, tipRequest: TipRequest): Promise<{ api: API; provider: PolkadotClient }> {
  const { bot } = state;

  const chainConfig = getChainConfig(tipRequest.contributor.account.network);
  const jsonRpcProvider = WebSocketProvider(chainConfig.providerEndpoint);
  const client = createClient(jsonRpcProvider);

  // Check that it works
  await client.getFinalizedBlock();

  // Set up the types
  const polkadotClient: API = client.getTypedApi(polkadot);

  // TODO: Find all the equivalent to the other method
  const version = await polkadotClient.constants.System.Version();
  bot.log(`You are connected using the version ${version.authoring_version}`);

  /*
  // Get general information about the node we are connected to
  const [chain, nodeName, nodeVersion] = await Promise.all([
    api.rpc.system.chain(),
    api.rpc.system.name(),
    api.rpc.system.version(),
  ]);

  bot.log(`You are connected to chain ${chain.toString()} using ${version.authoring_version} v${nodeVersion.toString()}`);
  //*/

  return { api: polkadotClient, provider: client };
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
    provider.destroy();
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
    const preparedExtrinsic = await tipOpenGovReferendumExtrinsic({ api, tipRequest });
    if (!preparedExtrinsic.success) {
      return preparedExtrinsic;
    }

    const { botTipAccount } = state;

    const { txHash } = await preparedExtrinsic.referendumExtrinsic.signAndSubmit(botTipAccount);
    const chainConfig = getChainConfig(tipRequest.contributor.account.network);
    const polkadotAppsUrl = `https://polkadot.js.org/apps/?rpc=${encodeURIComponent(chainConfig.providerEndpoint)}#/`;
    const extrinsicCreationLink = `${polkadotAppsUrl}extrinsics/decode/${txHash}`;
    return { success: true, extrinsicCreationLink };
  } finally {
    provider.destroy();
  }
}
