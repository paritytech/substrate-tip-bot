import "@polkadot/api-augment";
import "@polkadot/types-augment";
import { ApiPromise } from "@polkadot/api";
import { KeyringPair } from "@polkadot/keyring/types";
import { ISubmittableResult } from "@polkadot/types/types";
import { blake2AsHex } from "@polkadot/util-crypto";
import assert from "assert";
import { Probot } from "probot";

import { getChainConfig, getTipUrl } from "./chain-config";
import { ContributorAccount, State, TipRequest, TipResult } from "./types";
import { formatReason, tipSizeToOpenGovTrack } from "./util";

export async function tipOpenGov(opts: {
  state: State;
  api: ApiPromise;
  tipRequest: TipRequest;
  botTipAccount: KeyringPair;
}): Promise<TipResult> {
  const {
    state: { bot },
    api,
    tipRequest,
    botTipAccount,
  } = opts;
  const { contributor } = tipRequest;
  const chainConfig = getChainConfig(contributor.account.network);
  assert(chainConfig.tipType === "opengov");

  const track = tipSizeToOpenGovTrack(tipRequest);
  if ("error" in track) {
    return { success: false, errorMessage: track.error };
  }
  const contributorAddress = contributor.account.address;

  const proposalTx = api.tx.utility.batch([
    api.tx.system.remark(formatReason(tipRequest)),
    api.tx.treasury.spend(track.value.toString(), contributorAddress),
  ]);
  const encodedProposal = proposalTx.method.toHex();
  const proposalHash = blake2AsHex(encodedProposal);
  const encodedLength = Math.ceil((encodedProposal.length - 2) / 2);

  console.log(`encodedLength: ${encodedLength}`);

  return await new Promise(async (resolve, reject) => {
    // create a preimage from opengov with the encodedProposal above
    const preimageUnsubscribe = await api.tx.preimage
      .notePreimage(encodedProposal)
      .signAndSend(botTipAccount, { nonce: -1 }, async (result) => {
        await signAndSendCallback(bot, contributor.account, "preimage", preimageUnsubscribe, result)
          .then(async () => {
            const readPreimage = await api.query.preimage.statusFor(proposalHash);

            if (readPreimage.isEmpty) {
              reject(new Error(`Preimage for ${proposalHash} was not found, check if the bot has enough funds.`));
            }

            const proposalUnsubscribe = await api.tx.referenda
              .submit(
                // TODO: There should be a way to set those types properly.
                { Origins: track.track } as never,
                { Lookup: { hash: proposalHash, length: proposalTx.length - 1 } },
                { after: 10 } as never,
              )
              .signAndSend(botTipAccount, { nonce: -1 }, async (refResult) => {
                await signAndSendCallback(bot, contributor.account, "referendum", proposalUnsubscribe, refResult)
                  .then(resolve)
                  .catch(reject);
              });
          })
          .catch(reject);
      });
  });
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
    } else if (
      result.status.isDropped ||
      result.status.isInvalid ||
      result.status.isUsurped ||
      result.status.isRetracted ||
      result.status.isBroadcast
    ) {
      const msg = `Tip for ${contributor.address} ${type} status is 👎: ${result.status.type}`;
      bot.log(msg, result.status);
      reject({ success: false, errorMessage: msg });
    } else {
      bot.log(`Tip for ${contributor.address} ${type} status: ${result.status.type}`, result.status);
    }
  });
}
