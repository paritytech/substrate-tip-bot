import "@polkadot/api-augment";
import "@polkadot/types-augment";
import { until } from "@eng-automation/js";
import { ApiPromise } from "@polkadot/api";
import { ISubmittableResult } from "@polkadot/types/types";
import { Probot } from "probot";

import { getTipUrl } from "./chain-config";
import { ContributorAccount, State, TipRequest, TipResult } from "./types";
import { byteSize, formatReason, tipSizeToOpenGovTrack } from "./util";

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
  const contributorAddress = contributor.account.address;

  const proposalTx = api.tx.treasury.spend(track.value.toString(), contributorAddress);
  const nonce = (await api.rpc.system.accountNextIndex(botTipAccount.address)).toNumber();
  const encodedProposal = proposalTx.method.toHex();
  const proposalByteSize = byteSize(encodedProposal);
  if (proposalByteSize >= 128) {
    return {
      success: false,
      errorMessage: `The proposal length of ${proposalByteSize} equals or exceeds 128 bytes and cannot be inlined in the referendum.`,
    };
  }

  bot.log(
    `Tip proposal for ${contributor.account.address}, encoded proposal byte size: ${proposalByteSize}, nonce: ${nonce}`,
  );

  const referendumId = await api.query.referenda.referendumCount(); // The next free referendum index.
  const tipResult = await new Promise<TipResult>(async (resolve, reject) => {
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

  if (tipResult.success && polkassembly) {
    void (async () => {
      const condition = async (): Promise<boolean> => {
        const lastReferendum = await polkassembly.getLastReferendumNumber(
          contributor.account.network,
          track.track.trackNo,
        );
        return lastReferendum !== undefined && lastReferendum >= referendumId.toNumber();
      };
      try {
        bot.log.info(`Waiting until referendum ${referendumId.toString()} appears on Polkasssembly`);
        await until(condition, 30_000);
        polkassembly.logout();
        await polkassembly.loginOrSignup();
        await polkassembly.editPost(tipRequest.contributor.account.network, {
          postId: referendumId.toNumber(),
          proposalType: "referendums_v2",
          content: formatReason(tipRequest, { markdown: true }),
          title: track.track.trackName,
        });
        bot.log.info(`Successfully updated Polkasssembly metadata for referendum ${referendumId.toString()}`);
      } catch (e) {
        bot.log.error("Failed to update the Polkasssembly metadata", {
          referendumId: referendumId.toNumber(),
          tipRequest: JSON.stringify(tipRequest),
        });
        bot.log.error(e.message);
      }
    })();
  }

  return tipResult;
}

async function signAndSendCallback(
  bot: Probot,
  contributor: ContributorAccount,
  type: "preimage" | "referendum",
  unsubscribe: () => void,
  result: ISubmittableResult,
): Promise<TipResult> {
  return await new Promise((resolve, reject) => {
    const resolveSuccess = () => {
      unsubscribe();
      resolve({ success: true, tipUrl: getTipUrl(contributor.network) });
    };
    if (result.status.isInBlock) {
      bot.log(`${type} for ${contributor.address} included at blockHash ${result.status.asInBlock.toString()}`);
      if (process.env.NODE_ENV === "test") {
        // Don't have to wait for block finalization in a test environment.
        resolveSuccess();
      }
    } else if (result.status.isFinalized) {
      bot.log(`Tip for ${contributor.address} ${type} finalized at blockHash ${result.status.asFinalized.toString()}`);
      resolveSuccess();
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
