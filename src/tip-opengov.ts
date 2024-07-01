import { until } from "@eng-automation/js";
import { PolkadotRuntimeOriginCaller, PreimagesBounded, TraitsScheduleDispatchTime } from "@polkadot-api/descriptors";
import "@polkadot/api-augment";
import "@polkadot/types-augment";
import { ISubmittableResult } from "@polkadot/types/types";
import type { BN } from "@polkadot/util";
import { Probot } from "probot";

import { Binary, TxPromise } from "polkadot-api";
import { Polkassembly } from "./polkassembly/polkassembly";
import { API } from "./tip";
import { ContributorAccount, OpenGovTrack, State, TipRequest, TipResult } from "./types";
import { encodeProposal, formatReason, getReferendumId, tipSizeToOpenGovTrack } from "./util";

type ExtrinsicResult = { success: true; blockHash: string } | { success: false; errorMessage: string };

export async function tipOpenGovReferendumExtrinsic(opts: { api: API; tipRequest: TipRequest }): Promise<
  | Exclude<TipResult, { success: true }>
  | {
      success: true;
      referendumExtrinsic: { signAndSubmit: TxPromise<"promise"> };
      proposalByteSize: number;
      encodedProposal: Binary;
      track: { track: OpenGovTrack; value: BN };
    }
> {
  const { api, tipRequest } = opts;
  const track = tipSizeToOpenGovTrack(tipRequest);
  if ("error" in track) {
    return { success: false, errorMessage: track.error };
  }

  const encodeProposalResult = await encodeProposal(api, tipRequest);
  if ("success" in encodeProposalResult) {
    return encodeProposalResult;
  }
  const { encodedProposal, proposalByteSize } = encodeProposalResult;

  const proposal = PreimagesBounded.Inline(encodedProposal);
  const proposalOrigin = PolkadotRuntimeOriginCaller.Origins(track.track.trackName);
  const enactMoment = TraitsScheduleDispatchTime.After(10);
  const referendumExtrinsic = api.tx.Referenda.submit({
    proposal,
    proposal_origin: proposalOrigin,
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

export async function tipOpenGov(opts: { state: State; api: API; tipRequest: TipRequest }): Promise<TipResult> {
  const {
    state: { bot, botTipAccount },
    api,
    tipRequest,
  } = opts;
  const { contributor } = tipRequest;

  const preparedExtrinsic = await tipOpenGovReferendumExtrinsic({ api, tipRequest });
  if (!preparedExtrinsic.success) {
    return preparedExtrinsic;
  }
  const { proposalByteSize, referendumExtrinsic, encodedProposal, track } = preparedExtrinsic;

  const nonce = await api.apis.AccountNonceApi.account_nonce(botTipAccount.address);
  bot.log(
    `Tip proposal for ${contributor.account.address}, encoded proposal byte size: ${proposalByteSize}, nonce: ${nonce}`,
  );

  const extrinsicResult = await new Promise<ExtrinsicResult>(async (resolve, reject) => {
    try {
      // TODO: Convert this method
      const proposalUnsubscribe = await referendumExtrinsic.signAndSubmit(botTipAccount, async (refResult) => {
        await signAndSendCallback(bot, contributor.account, "referendum", proposalUnsubscribe, refResult)
          .then(resolve)
          .catch(reject);
      });
    } catch (e) {
      reject(e);
    }
  });

  if (extrinsicResult.success === false) {
    return extrinsicResult;
  }

  return {
    success: extrinsicResult.success,
    referendumNumber: await tryGetReferendumId(api, extrinsicResult.blockHash, encodedProposal.asHex(), bot.log),
    blockHash: extrinsicResult.blockHash,
    track: track.track,
    value: track.value,
  };
}

async function signAndSendCallback(
  bot: Probot,
  contributor: ContributorAccount,
  type: "preimage" | "referendum",
  unsubscribe: () => void,
  result: ISubmittableResult,
): Promise<ExtrinsicResult> {
  return await new Promise((resolve, reject) => {
    const resolveSuccess = (blockHash: string) => {
      unsubscribe();
      resolve({ success: true, blockHash });
    };
    if (result.status.isInBlock) {
      const blockHash = result.status.asInBlock.toString();
      bot.log(`${type} for ${contributor.address} included at blockHash ${blockHash}`);
      if (process.env.NODE_ENV === "test") {
        // Don't have to wait for block finalization in a test environment.
        resolveSuccess(blockHash);
      }
    } else if (result.status.isFinalized) {
      const blockHash = result.status.asFinalized.toString();
      bot.log(`Tip for ${contributor.address} ${type} finalized at blockHash ${blockHash}`);
      resolveSuccess(blockHash);
    } else if (result.isError) {
      bot.log(`status to string`, result.status.toString());
      bot.log(`result.toHuman`, result.toHuman());
      bot.log(`result`, result);

      const msg = `Tip for ${contributor.address} ${type} status is 👎: ${result.status.type}`;
      bot.log(msg, result.status);
      unsubscribe();
      reject({ success: false, errorMessage: msg });
    } else {
      bot.log(`Tip for ${contributor.address} ${type} status: ${result.status.type}`);
    }
  });
}

const tryGetReferendumId = async (
  api: API,
  blockHash: string,
  encodedProposal: string,
  log: Probot["log"],
): Promise<null | number> => {
  try {
    // TODO: Convert
    const referendumId = await getReferendumId(await api.at(blockHash), encodedProposal);
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
