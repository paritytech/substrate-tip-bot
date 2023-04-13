import { ApiPromise, SubmittableResult } from "@polkadot/api";
import { KeyringPair } from "@polkadot/keyring/types";
import assert from "assert";

import { State, TipRequest } from "./types";

export async function tipGov1(opts: {
  state: State;
  api: ApiPromise;
  tipRequest: TipRequest;
  botTipAccount: KeyringPair;
}): Promise<void> {
  const {
    state: { bot },
    api,
    tipRequest,
    botTipAccount,
  } = opts;
  const { contributor, pullRequestNumber, pullRequestRepo, tip } = tipRequest;
  assert(tip.type === "gov1");

  const reason = `TO: ${contributor.githubUsername} FOR: ${pullRequestRepo}#${pullRequestNumber} (${tip.size})`;
  /* TODO before submitting, check tip does not already exist via a storage query.
         TODO potentially prevent duplicates by also checking for reasons with the other sizes. */
  const unsub = await api.tx.tips
    .reportAwesome(reason, contributor.account.address)
    .signAndSend(botTipAccount, { nonce: -1 }, (result: SubmittableResult) => {
      bot.log(`Current status is ${result.status.toString()}`);
      if (result.status.isInBlock) {
        bot.log(`Tip included at blockHash ${result.status.asInBlock.toString()}`);
      } else if (result.status.isFinalized) {
        bot.log(`Tip finalized at blockHash ${result.status.asFinalized.toString()}`);
        unsub();
      }
    });
  await api.disconnect();
}
