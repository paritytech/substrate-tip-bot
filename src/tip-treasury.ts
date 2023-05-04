import { ApiPromise, SubmittableResult } from "@polkadot/api";
import { KeyringPair } from "@polkadot/keyring/types";
import assert from "assert";

import { getTipUrl } from "./chain-config";
import { State, TipRequest, TipResult } from "./types";
import { formatReason } from "./util";

export async function tipTreasury(opts: {
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
  const { contributor, tip } = tipRequest;
  assert(tip.type === "treasury");

  /* TODO before submitting, check tip does not already exist via a storage query.
         TODO potentially prevent duplicates by also checking for reasons with the other sizes. */
  const unsub = await api.tx.tips
    .reportAwesome(formatReason(tipRequest), contributor.account.address)
    .signAndSend(botTipAccount, { nonce: -1 }, (result: SubmittableResult) => {
      bot.log(`Current status is ${result.status.toString()}`);
      if (result.status.isInBlock) {
        bot.log(`Tip included at blockHash ${result.status.asInBlock.toString()}`);
      } else if (result.status.isFinalized) {
        bot.log(`Tip finalized at blockHash ${result.status.asFinalized.toString()}`);
        unsub();
      }
    });

  return { success: true, tipUrl: getTipUrl(tipRequest) };
}
