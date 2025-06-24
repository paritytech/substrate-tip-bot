import { until } from "@eng-automation/js";
import { PreimagesBounded, TraitsScheduleDispatchTime } from "@polkadot-api/descriptors";
import { ss58Address } from "@polkadot-labs/hdkd-helpers";
import { getDescriptor } from "#src/chain-config";
import { Binary, Enum, PolkadotClient, Transaction } from "polkadot-api";
import { Probot } from "probot";

import { Polkassembly } from "./polkassembly/polkassembly";
import { OpenGovTrack, State, TipNetwork, TipRequest, TipResult } from "./types";
import { encodeProposal, formatReason, tipSizeToOpenGovTrack } from "./util";

export async function tipOpenGovReferendumExtrinsic(opts: { client: PolkadotClient; tipRequest: TipRequest }): Promise<
  | Exclude<TipResult, { success: true }>
  | {
      success: true;
      referendumExtrinsic: Transaction<object, "Referenda", "submit", unknown>;
      proposalByteSize: number;
      encodedProposal: Binary;
      track: { track: OpenGovTrack; value: bigint };
    }
> {
  const { client, tipRequest } = opts;
  const track = tipSizeToOpenGovTrack(tipRequest);
  if ("error" in track) {
    return { success: false, errorMessage: track.error };
  }

  const encodeProposalResult = await encodeProposal(client, tipRequest);
  if ("success" in encodeProposalResult) {
    return encodeProposalResult;
  }
  const { encodedProposal, proposalByteSize } = encodeProposalResult;

  const proposal = PreimagesBounded.Inline(encodedProposal);

  const enactMoment = TraitsScheduleDispatchTime.After(10);

  const network: TipNetwork = tipRequest.contributor.account.network;

  const api = client.getTypedApi(getDescriptor(network));
  const referendumExtrinsic = api.tx.Referenda.submit({
    proposal,
    proposal_origin: Enum("Origins", Enum(track.track.trackName.type)),
    enactment_moment: enactMoment,
  });

  return {
    success: true,
    referendumExtrinsic,
    proposalByteSize,
    encodedProposal,
    track,
  };
}

export async function tipOpenGov(opts: {
  state: State;
  client: PolkadotClient;
  tipRequest: TipRequest;
}): Promise<TipResult> {
  const {
    state: { bot, botTipAccount },
    client,
    tipRequest,
  } = opts;
  const { contributor } = tipRequest;
  const network = tipRequest.contributor.account.network;

  const preparedExtrinsic = await tipOpenGovReferendumExtrinsic({ client, tipRequest });
  if (!preparedExtrinsic.success) {
    return preparedExtrinsic;
  }
  const { proposalByteSize, referendumExtrinsic, encodedProposal, track } = preparedExtrinsic;

  const address = ss58Address(botTipAccount.publicKey);
  const api = client.getTypedApi(getDescriptor(network));
  const nonce = await api.apis.AccountNonceApi.account_nonce(address);
  bot.log(
    `Tip proposal for ${contributor.account.address}, encoded proposal byte size: ${proposalByteSize}, nonce: ${nonce}`,
  );

  try {
    const result = await referendumExtrinsic.signAndSubmit(botTipAccount);
    bot.log(`referendum for ${contributor.account.address} included at blockHash ${result.block.hash}`);

    const referendumEvents = api.event.Referenda.Submitted.filter(result.events).filter((event) => {
      const proposal = event.proposal.value;
      const proposalHex = (proposal instanceof Binary ? proposal : proposal.hash).asHex();
      return proposalHex === encodedProposal.asHex();
    });
    if (referendumEvents.length === 0) {
      return {
        success: false,
        errorMessage: `Transaction ${result.txHash} was submitted, but no "Referenda.Submitted" events were produced`,
      };
    }

    return {
      success: true,
      referendumNumber: referendumEvents[0].index,
      blockHash: result.block.hash,
      track: track.track,
      value: track.value,
    };
  } catch (e) {
    const msg = `Tip for ${contributor.account.address} referendum status is 👎: ${e}`;
    bot.log.error(e, msg);
    return { success: false, errorMessage: msg };
  }
}

export const updatePolkassemblyPost = async (opts: {
  polkassembly: Polkassembly;
  referendumId: number;
  tipRequest: TipRequest;
  track: OpenGovTrack;
  log: Probot["log"];
}): Promise<{ url: string }> => {
  const { polkassembly, referendumId, tipRequest, track, log } = opts;
  const condition = async (): Promise<boolean> => {
    const lastReferendum = await polkassembly.getLastReferendumNumber(
      tipRequest.contributor.account.network,
      track.trackNo,
    );
    return lastReferendum !== undefined && lastReferendum >= referendumId;
  };
  log.info(`Waiting until referendum ${referendumId.toString()} appears on Polkasssembly`);
  await until(condition, 30_000);
  polkassembly.logout();
  await polkassembly.loginOrSignup(tipRequest.contributor.account.network);
  await polkassembly.editPost(tipRequest.contributor.account.network, {
    postId: referendumId,
    proposalType: "referendums_v2",
    content: formatReason(tipRequest, { markdown: true }),
    title: track.trackName.type,
  });
  log.info(`Successfully updated Polkasssembly metadata for referendum ${referendumId.toString()}`);
  return {
    url: `https://${tipRequest.contributor.account.network}.polkassembly.io/referenda/${referendumId.toString()}`,
  };
};
