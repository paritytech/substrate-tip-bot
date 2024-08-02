import { createClient, PolkadotClient, TypedApi } from "polkadot-api";
import { WebSocketProvider } from "polkadot-api/ws-provider/node";

import { ChainDescriptor, getChainConfig, getDescriptor, papiConfig } from "./chain-config";
import { tipOpenGov, tipOpenGovReferendumExtrinsic } from "./tip-opengov";
import { State, TipNetwork, TipRequest, TipResult } from "./types";

export type API<T extends TipNetwork> = TypedApi<ChainDescriptor<T>>;

async function createApi(
  network: TipNetwork,
  state: State,
): Promise<{
  client: PolkadotClient;
}> {
  const { bot } = state;

  const jsonRpcProvider = WebSocketProvider(papiConfig.entries[network].wsUrl);
  const client = createClient(jsonRpcProvider);

  // Check that it works
  await client.getFinalizedBlock();

  // Set up the types
  const api = client.getTypedApi(getDescriptor(network));

  // TODO: Find all the equivalent to the other method
  const version = await api.apis.Core.version();
  bot.log(`You are connected to chain ${network} using the version ${version.authoring_version}`);

  /*
  // Get general information about the node we are connected to
  const [chain, nodeName, nodeVersion] = await Promise.all([
    api.rpc.system.chain(),
    api.rpc.system.name(),
    api.rpc.system.version(),
  ]);

  bot.log(`You are connected to chain ${chain.toString()} using ${version.authoring_version} v${nodeVersion.toString()}`);
  //*/

  return { client: client };
}

/**
 * Tips the user using the Bot account.
 * The bot will send the referendum creation transaction itself and pay for the fees.
 */
export async function tipUser(state: State, tipRequest: TipRequest): Promise<TipResult> {
  const { client } = await createApi(tipRequest.contributor.account.network, state);

  try {
    return await tipOpenGov({ state, client, tipRequest });
  } finally {
    client.destroy();
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
  const { client } = await createApi(tipRequest.contributor.account.network, state);

  try {
    const preparedExtrinsic = await tipOpenGovReferendumExtrinsic({ client, tipRequest });
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
    client.destroy();
  }
}
