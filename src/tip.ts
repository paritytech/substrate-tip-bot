import { createClient, PolkadotClient, TypedApi } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/node";

import { ChainDescriptor, getDescriptor, getWsUrl } from "./chain-config";
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

  const provider = getWsProvider(getWsUrl(network));
  const client = createClient(provider);

  // Check that it works
  await client.getFinalizedBlock();

  // Set up the types
  const api = client.getTypedApi(getDescriptor(network));

  try {
    const version = await api.apis.Core.version();
    bot.log(`You are connected to chain ${version.spec_name}#${version.spec_version}`);
  } catch (e) {
    console.error("Error getting core version", e);
  }

  return { client };
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

    const transactionHex = (await preparedExtrinsic.referendumExtrinsic.getEncodedData()).asHex();

    const polkadotAppsUrl = `https://polkadot.js.org/apps/?rpc=${getWsUrl(network)}#/`;
    const extrinsicCreationLink = `${polkadotAppsUrl}extrinsics/decode/${transactionHex}`;
    return { success: true, extrinsicCreationLink };
  } catch (e) {
    return { success: false, errorMessage: e instanceof Error ? e.stack ?? e.message : String(e) };
  } finally {
    client.destroy();
  }
}
