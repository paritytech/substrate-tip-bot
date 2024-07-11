import "@polkadot/api-augment";
import "@polkadot/types-augment";
import { until } from "@eng-automation/js";
import type { BN } from "@polkadot/util";
import { PolkadotRuntimeOriginCaller, PreimagesBounded, TraitsScheduleDispatchTime } from "@polkadot-api/descriptors";
import { getPolkadotSigner } from "@polkadot-api/signer";
import { Binary, TxFinalizedPayload, TxPromise } from "polkadot-api";
import { Probot } from "probot";

import { Polkassembly } from "./polkassembly/polkassembly";
import { API } from "./tip";
import { ContributorAccount, OpenGovTrack, State, TipRequest, TipResult } from "./types";
import { encodeProposal, formatReason, getReferendumId, tipSizeToOpenGovTrack } from "./util";
import { ss58Address } from "@polkadot-labs/hdkd-helpers";

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

  const address = ss58Address(botTipAccount.publicKey);
  const nonce = await api.apis.AccountNonceApi.account_nonce(address);
  bot.log(
    `Tip proposal for ${contributor.account.address}, encoded proposal byte size: ${proposalByteSize}, nonce: ${nonce}`,
  );

  const extrinsicResult = await new Promise<ExtrinsicResult>(async (resolve, reject) => {
    try {
      const signer = getPolkadotSigner(botTipAccount.publicKey, "Sr25519", (input) => botTipAccount.sign(input));
      const result = await referendumExtrinsic.signAndSubmit(signer);
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
  api: API,
  blockHash: string,
  encodedProposal: string,
  log: Probot["log"],
): Promise<null | number> => {
  try {
    const referendumId = await getReferendumId(api, blockHash, encodedProposal);
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
