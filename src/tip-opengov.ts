import "@polkadot/api-augment";
import "@polkadot/types-augment";
import { ApiPromise } from "@polkadot/api";
import type { SubmittableExtrinsic } from "@polkadot/api/promise/types";
import { KeyringPair } from "@polkadot/keyring/types";
import { blake2AsHex } from "@polkadot/util-crypto";
import assert from "assert";

import { State, TipRequest } from "./types";

export async function tipOpenGov(opts: {
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
  const { contributor } = tipRequest;
  assert(tipRequest.tip.type === "opengov");

  const xt = api.tx.treasury.spend(5000000000000, contributor.account.address);
  const encodedProposal = (xt as SubmittableExtrinsic)?.method.toHex() || "";
  const encodedHash = blake2AsHex(encodedProposal);
  const proposalLength = xt.length - 1;

  const preimageFinalizedPromise = new Promise<void>(async (res, rej) => {
    const unsub = await api.tx.preimage.notePreimage(encodedProposal).signAndSend(botTipAccount, (result) => {
      if (result.status.isInBlock) {
        bot.log(`Current status is ${result.status.toString()}`);
        bot.log(`Preimage Upload included at blockHash ${result.status.asInBlock.toString()}`);
        /* if (process.env.NODE_ENV === "test") {
             // Don't wait for finalization if this is only a test.
             unsub();
             res();
           } */
      } else if (result.status.isFinalized) {
        bot.log(`Preimage Upload finalized at blockHash ${result.status.asFinalized.toString()}`);
        unsub();
        res();
      }
    });
  });

  await preimageFinalizedPromise;

  await api.tx.referenda
    .submit(
      { Origins: "SmallTipper" } as any, // eslint-disable-line
      { Lookup: { hash: encodedHash, length: proposalLength } },
      { after: 10 } as any, // eslint-disable-line
      // '{ "after": 10 }'
    )
    .signAndSend(botTipAccount);
}
