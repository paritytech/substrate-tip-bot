import { until } from "@eng-automation/js";
import {
  GovernanceOrigin,
  PolkadotRuntimeOriginCaller,
  PreimagesBounded,
  TraitsScheduleDispatchTime,
  WestendRuntimeGovernanceOriginsPalletCustomOriginsOrigin,
  WestendRuntimeOriginCaller,
} from "@polkadot-api/descriptors";
import { ss58Address } from "@polkadot-labs/hdkd-helpers";
import { getDescriptor } from "#src/chain-config";
import { Binary, PolkadotClient, TxFinalizedPayload, TxPromise } from "polkadot-api";
import { Probot } from "probot";

import { Polkassembly } from "./polkassembly/polkassembly";
import { ContributorAccount, OpenGovTrack, State, TipNetwork, TipRequest, TipResult } from "./types";
import { encodeProposal, formatReason, getReferendumId, tipSizeToOpenGovTrack } from "./util";

type ExtrinsicResult = { success: true; blockHash: string } | { success: false; errorMessage: string };

export async function tipOpenGovReferendumExtrinsic(opts: { client: PolkadotClient; tipRequest: TipRequest }): Promise<
  | Exclude<TipResult, { success: true }>
  | {
      success: true;
      referendumExtrinsic: { signAndSubmit: TxPromise<"promise"> };
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

  let referendumExtrinsic: { signAndSubmit: TxPromise<"promise"> };
  const network: TipNetwork = tipRequest.contributor.account.network;
  if (network === "westend" || network === "localwestend" || network === "rococo" || network === "localrococo") {
    const api = client.getTypedApi(getDescriptor(network));
    const proposalOrigin = WestendRuntimeOriginCaller.Origins(
      track.track.trackName as WestendRuntimeGovernanceOriginsPalletCustomOriginsOrigin,
    );
    referendumExtrinsic = api.tx.Referenda.submit({
      proposal,
      proposal_origin: proposalOrigin,
      enactment_moment: enactMoment,
    });
  } else {
    const api = client.getTypedApi(getDescriptor(network));
    const proposalOrigin = PolkadotRuntimeOriginCaller.Origins(track.track.trackName as GovernanceOrigin);
    referendumExtrinsic = api.tx.Referenda.submit({
      proposal,
      proposal_origin: proposalOrigin,
      enactment_moment: enactMoment,
    });
  }

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

  const extrinsicResult = await new Promise<ExtrinsicResult>(async (resolve, reject) => {
    try {
      const result = await referendumExtrinsic.signAndSubmit(botTipAccount);
      await signAndSendCallback(bot, contributor.account, "referendum", result).then(resolve).catch(reject);
    } catch (e) {
      reject(e);
    }
  });

  if (extrinsicResult.success === false) {
    return extrinsicResult;
  }

  return {
    success: extrinsicResult.success,
    referendumNumber: await tryGetReferendumId(
      client,
      network,
      extrinsicResult.blockHash,
      encodedProposal.asHex(),
      bot.log,
    ),
    blockHash: extrinsicResult.blockHash,
    track: track.track,
    value: track.value,
  };
}

async function signAndSendCallback(
  bot: Probot,
  contributor: ContributorAccount,
  type: "preimage" | "referendum",
  result: TxFinalizedPayload,
): Promise<ExtrinsicResult> {
  return await new Promise((resolve, reject) => {
    if (result.ok) {
      const blockHash = result.block.hash;
      bot.log(`${type} for ${contributor.address} included at blockHash ${blockHash}`);
      if (process.env.NODE_ENV === "test") {
        // Don't have to wait for block finalization in a test environment.
        resolve({ success: true, blockHash });
      }
    } else {
      bot.log(`status to string`, result.events);
      bot.log(`result.json`, JSON.stringify(result));
      bot.log(`result`, result);

      const lastEvent = result.events[result.events.length - 1];

      const msg = `Tip for ${contributor.address} ${type} status is 👎: ${lastEvent.value.type}: ${lastEvent.value.value}`;
      bot.log(msg, result.events);
      reject({ success: false, errorMessage: msg });
    }
  });
}

const tryGetReferendumId = async (
  client: PolkadotClient,
  network: TipNetwork,
  blockHash: string,
  encodedProposal: string,
  log: Probot["log"],
): Promise<null | number> => {
  try {
    const referendumId = await getReferendumId(client, network, blockHash, encodedProposal);
    if (referendumId === undefined) {
      log.error(
        `Could not find referendumId in block ${blockHash}. EncodedProposal="${encodedProposal}". Polkassembly post will NOT be updated.`,
      );
      return null;
    }
    return referendumId;
  } catch (e) {
    log.error(
      `Error when trying to find referendumId in block ${blockHash}. EncodedProposal="${encodedProposal}". Polkassembly post will NOT be updated.`,
    );
    log.error(e.message);
    return null;
  }
};

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
