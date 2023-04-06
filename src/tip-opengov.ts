import "@polkadot/api-augment";
import "@polkadot/types-augment";

import { ApiPromise, Keyring, SubmittableResult, WsProvider } from "@polkadot/api";
import { blake2AsHex } from '@polkadot/util-crypto';
import type { SubmittableExtrinsic } from '@polkadot/api/promise/types';
import { Contributor, State } from "./types";

export async function Gov2tipUser(

): Promise<{ success: boolean; tipUrl: string }> {
  //export async function Gov2tipUser(api, amount, recipientAccount) {

  const wsProvider = new WsProvider('ws://127.0.0.1:9944');
  const api = await ApiPromise.create({ provider: wsProvider });
  await api.isReady;

  const keyring = new Keyring({ type: "sr25519" });

  const seedOfTipperAccount = "//Alice"
  const seedOfRecipientAccount = "//Charlie"

  const botTipAccount = keyring.addFromUri(seedOfTipperAccount);
  const recipientAccount = keyring.addFromUri(seedOfRecipientAccount);

  const proposal = {
    amount: 5000000000000, //50 DOT
    beneficiary: recipientAccount,
  }

  const xt = api.tx.treasury.spend(proposal.amount, proposal.beneficiary.address);
  const encodedProposal = (xt as SubmittableExtrinsic)?.method.toHex() || '';
  const encodedHash = blake2AsHex(encodedProposal);
  //const proposalLength = xt.length - 1;

  const unsub_preimage = await api.tx.preimage
    .notePreimage(encodedProposal)
    .signAndSend(botTipAccount, (result: SubmittableResult) => {
      if (result.status.isInBlock) {
        console.log(`Current status is ${result.status.toString()}`);
        console.log(`Preimage Upload included at blockHash ${result.status.asInBlock.toString()}`);
      } else if (result.status.isFinalized) {
        console.log(`Preimage Upload finalized at blockHash ${result.status.asFinalized.toString()}`);
        unsub_preimage();
      }
    });

  const unsub_referenda = await api.tx.proxy
    .proxy(
      botTipAccount.address,
      'Governance',
      api.tx.referenda.submit(
        '{ "Origins": "SmallTipper" }',
        encodedHash,
        '{ "after": 10 }'
      )
    )
    .signAndSend(botTipAccount, (result: SubmittableResult) => {
      console.log(`Current status is ${result.status.toString()}`);
      if (result.status.isInBlock) {
        console.log(`Referendum submitted at blockHash ${result.status.asInBlock.toString()}`);
      } else if (result.status.isFinalized) {
        console.log(`Referendum finalized at blockHash ${result.status.asInBlock.toString()}`);
        unsub_referenda();
      }
    });

  return { success: true, tipUrl: "" };
}

