import "@polkadot/api-augment";
import "@polkadot/types-augment";
import { ApiPromise } from "@polkadot/api";
import { ISubmittableResult } from "@polkadot/types/types";
import { blake2AsHex } from "@polkadot/util-crypto";
import assert from "assert";
import { until } from "opstooling-js";
import { Probot } from "probot";

import { getChainConfig, getTipUrl } from "./chain-config";
import { ContributorAccount, State, TipRequest, TipResult } from "./types";
import { formatReason, tipSizeToOpenGovTrack } from "./util";

export async function tipOpenGov(opts: { state: State; api: ApiPromise; tipRequest: TipRequest }): Promise<TipResult> {
  const {
    state: { bot, botTipAccount, polkassembly },
    api,
    tipRequest,
  } = opts;
  const { contributor } = tipRequest;
  const chainConfig = getChainConfig(contributor.account.network);
  assert(chainConfig.tipType === "opengov");

  const track = tipSizeToOpenGovTrack(tipRequest);
  if ("error" in track) {
    return { success: false, errorMessage: track.error };
  }
  const contributorAddress = contributor.account.address;

  const proposalTx = api.tx.treasury.spend(track.value.toString(), contributorAddress);
  const nonce = (await api.rpc.system.accountNextIndex(botTipAccount.address)).toNumber();
  const encodedProposal = proposalTx.method.toHex();
  const proposalHash = blake2AsHex(encodedProposal);
  const encodedLength = Math.ceil((encodedProposal.length - 2) / 2);

  bot.log(
    `Tip proposal for ${contributor.account.address} hash: ${proposalHash}, encoded length: ${encodedLength}, nonce: ${nonce}`,
  );

  const referendumId = await api.query.referenda.referendumCount(); // The next free referendum index.
  const tipResult = await new Promise<TipResult>(async (resolve, reject) => {
    // create a preimage from opengov with the encodedProposal above
    const preimageUnsubscribe = await api.tx.preimage
      .notePreimage(encodedProposal)
      .signAndSend(botTipAccount, async (result) => {
        await signAndSendCallback(bot, contributor.account, "preimage", preimageUnsubscribe, result)
          .then(async () => {
            const readPreimage = await api.query.preimage.statusFor(proposalHash);

            if (readPreimage.isEmpty) {
              reject(new Error(`Preimage for ${proposalHash} was not found, check if the bot has enough funds.`));
            }

            const proposalUnsubscribe = await api.tx.referenda
              .submit(
                // TODO: There should be a way to set those types properly.
                { Origins: track.track.trackName } as never,
                { Lookup: { hash: proposalHash, len: encodedLength } },
                { after: 10 } as never,
              )
              .signAndSend(botTipAccount, async (refResult) => {
                await signAndSendCallback(bot, contributor.account, "referendum", proposalUnsubscribe, refResult)
                  .then(resolve)
                  .catch(reject);
              });
          })
          .catch(reject);
      });
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
          content: formatReason(tipRequest),
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
    if (result.status.isInBlock) {
      bot.log(`${type} for ${contributor.address} included at blockHash ${result.status.asInBlock.toString()}`);
    } else if (result.status.isFinalized) {
      bot.log(`Tip for ${contributor.address} ${type} finalized at blockHash ${result.status.asFinalized.toString()}`);
      unsubscribe();
      resolve({ success: true, tipUrl: getTipUrl(contributor.network) });
    } else if (result.isError) {
      bot.log(`status to string`, result.status.toString());
      bot.log(`result.toHuman`, result.toHuman());
      bot.log(`result`, result);

      const msg = `Tip for ${contributor.address} ${type} status is 👎: ${result.status.type}`;
      bot.log(msg, result.status);
      reject({ success: false, errorMessage: msg });
    } else {
      bot.log(`Tip for ${contributor.address} ${type} status: ${result.status.type}`, result.status);
    }
  });
}
