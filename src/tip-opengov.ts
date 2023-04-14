import "@polkadot/api-augment";
import "@polkadot/types-augment";
import { ApiPromise } from "@polkadot/api";
import type { SubmittableExtrinsic } from "@polkadot/api/promise/types";
import { KeyringPair } from "@polkadot/keyring/types";
import { blake2AsHex } from "@polkadot/util-crypto";
import assert from "assert";

import { State, TipRequest } from "./types";
import { tipSizeToOpenGovTrack } from "./util";

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

  const track = tipSizeToOpenGovTrack(tipRequest.tip.size);

  const tx = api.tx.treasury.spend(track.value, contributor.account.address);
  const encodedProposal = (tx as SubmittableExtrinsic)?.method.toHex() || "";
  const encodedHash = blake2AsHex(encodedProposal);
  const proposalLength = tx.length - 1;

  const preimage_unsub = await api.tx.preimage
    .notePreimage(encodedProposal)
    .signAndSend(botTipAccount, { nonce: -1 }, (result) => {
      if (result.status.isInBlock) {
        bot.log(`Preimage Upload included at blockHash ${result.status.asInBlock.toString()}`);
      } else if (result.status.isFinalized) {
        bot.log(`Preimage Upload finalized at blockHash ${result.status.asFinalized.toString()}`);
        preimage_unsub();
      }
    });

  const referenda_unsub = await api.tx.referenda
    .submit(
      // TODO: There should be a way to set those types properly.
      { Origins: track.track } as any, // eslint-disable-line
      { Lookup: { hash: encodedHash, length: proposalLength } },
      { after: 10 } as any, // eslint-disable-line
    )
    .signAndSend(botTipAccount, { nonce: -1 }, (result) => {
      if (result.status.isInBlock) {
        bot.log(`Tip referendum included at blockHash ${result.status.asInBlock.toString()}`);
      } else if (result.status.isFinalized) {
        bot.log(`Tip referendum finalized at blockHash ${result.status.asFinalized.toString()}`);
        referenda_unsub();
      }
    });
}
