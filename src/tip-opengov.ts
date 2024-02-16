import "@polkadot/api-augment";
import "@polkadot/types-augment";
import { until } from "@eng-automation/js";
import { ApiPromise } from "@polkadot/api";
import { ISubmittableResult } from "@polkadot/types/types";
import { Probot } from "probot";

import { getTipUrl } from "./chain-config";
import { Polkassembly } from "./polkassembly/polkassembly";
import { ContributorAccount, OpenGovTrack, State, TipNetwork, TipRequest, TipResult } from "./types";
import { encodeProposal, formatReason, getReferendumId, tipSizeToOpenGovTrack } from "./util";

type ExtrinsicResult = {success: true, blockHash: string} | {success: false; errorMessage: string}

export async function tipOpenGov(opts: { state: State; api: ApiPromise; tipRequest: TipRequest }): Promise<TipResult> {
  const {
    state: { bot, botTipAccount, polkassembly },
    api,
    tipRequest,
  } = opts;
  const { contributor } = tipRequest;

  const track = tipSizeToOpenGovTrack(tipRequest);
  if ("error" in track) {
    return { success: false, errorMessage: track.error };
  }

  const encodeProposalResult = encodeProposal(api, tipRequest);
  if ("success" in encodeProposalResult) {
    return encodeProposalResult;
  }
  const { encodedProposal, proposalByteSize } = encodeProposalResult;

  const nonce = (await api.rpc.system.accountNextIndex(botTipAccount.address)).toNumber();
  bot.log(
    `Tip proposal for ${contributor.account.address}, encoded proposal byte size: ${proposalByteSize}, nonce: ${nonce}`,
  );

  const extrinsicResult = await new Promise<ExtrinsicResult>(async (resolve, reject) => {
    try {
      const proposalUnsubscribe = await api.tx.referenda
        .submit(
          // TODO: There should be a way to set those types properly.
          { Origins: track.track.trackName } as never,
          { Inline: encodedProposal },
          { after: 10 } as never,
        )
        .signAndSend(botTipAccount, async (refResult) => {
          await signAndSendCallback(bot, contributor.account, "referendum", proposalUnsubscribe, refResult)
            .then(resolve)
            .catch(reject);
        });
    } catch (e) {
      reject(e);
    }
  });

  if (extrinsicResult.success === false) {
    return extrinsicResult as TipResult
  }

  const tipResult: TipResult = {
    success: extrinsicResult.success,
    blockHash: extrinsicResult.blockHash,
    tipUrl: getTipUrl(contributor.account.network),
    track: track.track,
    value: track.value
  }

  if (tipResult.success && polkassembly) {
    const referendumId = await tryGetReferendumId(api, tipResult.blockHash, encodedProposal, bot.log);
    if (referendumId === null) {
      return tipResult;
    }
    // We fire off the Polkassembly separately, so the user doesn't have to wait for it to get a response.
    // But we await running the tryGetReferendumId first,
    // because we re-use the ApiPromise which gets disconnected at the end of a tip process.
    void tryUpdatingPolkassemblyPost(polkassembly, referendumId, tipRequest, track.track, bot.log);
  }

  return tipResult;
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
  api: ApiPromise,
  blockHash: string,
  encodedProposal: string,
  log: Probot["log"],
): Promise<null | number> => {
  try {
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

export const tryUpdatingPolkassemblyPost = async (opts: {
  polkassembly: Polkassembly,
  referendumId: number,
  tipRequest: TipRequest,
  network: TipNetwork,
  track: OpenGovTrack,
  log: Probot["log"],
}): Promise<void> => {
  const {polkassembly, referendumId, tipRequest, network, track, log} = opts;
  const condition = async (): Promise<boolean> => {
    const lastReferendum = await polkassembly.getLastReferendumNumber(
      network,
      track.trackNo,
    );
    return lastReferendum !== undefined && lastReferendum >= referendumId;
  };
  try {
    log.info(`Waiting until referendum ${referendumId.toString()} appears on Polkasssembly`);
    await until(condition, 30_000);
    polkassembly.logout();
    await polkassembly.loginOrSignup(network);
    await polkassembly.editPost(network, {
      postId: referendumId,
      proposalType: "referendums_v2",
      content: formatReason(tipRequest, { markdown: true }),
      title: track.trackName,
    });
    log.info(`Successfully updated Polkasssembly metadata for referendum ${referendumId.toString()}`);
  } catch (e) {
    log.error("Failed to update the Polkasssembly metadata", {
      referendumId: referendumId,
      tipRequest: JSON.stringify(tipRequest),
    });
    log.error(e.message);
  }
};
