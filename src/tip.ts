import { createClient, PolkadotClient, TypedApi } from "polkadot-api";
import { WebSocketProvider } from "polkadot-api/ws-provider/node";

import { ChainDescriptor, getDescriptor, papiConfig } from "./chain-config";
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

  const provider = WebSocketProvider(papiConfig.entries[network].wsUrl);
  const client = createClient(provider);

  // Check that it works
  await client.getFinalizedBlock();

  // Set up the types
  const api = client.getTypedApi(getDescriptor(network));

  const version = await api.apis.Core.version();
  bot.log(`You are connected to chain ${version.spec_name}#${version.spec_version}`);

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
  const { network } = tipRequest.contributor.account;
  const { client } = await createApi(network, state);

  try {
    const preparedExtrinsic = await tipOpenGovReferendumExtrinsic({ client, tipRequest });
    if (!preparedExtrinsic.success) {
      return preparedExtrinsic;
    }

    const { botTipAccount } = state;

    const { txHash } = await preparedExtrinsic.referendumExtrinsic.signAndSubmit(botTipAccount);
    const polkadotAppsUrl = `https://polkadot.js.org/apps/?rpc=${papiConfig.entries[network].wsUrl}#/`;
    const extrinsicCreationLink = `${polkadotAppsUrl}extrinsics/decode/${txHash}`;
    return { success: true, extrinsicCreationLink };
  } finally {
    client.destroy();
  }
}
