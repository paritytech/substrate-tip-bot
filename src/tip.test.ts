import "@polkadot/api-augment";
import { createTestKeyring } from "@polkadot/keyring";
import { ApiPromise } from "@polkadot/api";
import { HttpProvider } from "@polkadot/rpc-provider";
import { BN } from "@polkadot/util";
import { randomAsU8a } from "@polkadot/util-crypto";
import { until } from "opstooling-js";
import assert from "assert";
import { tipUser } from "./tip";
import { State, Tip } from "./types";



const randomAddress = () => createTestKeyring().addFromSeed(randomAsU8a(32)).address;

const state: State = {
  allowedGitHubOrg: 'test',
  allowedGitHubTeam: 'test',
  seedOfTipperAccount: '//Bob',
  bot: {
    log: console.log.bind(console)
  } as any
}
const tipperAccount = "14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3" //Bob

const tip: Tip = {
  tipSize: 'small',
  contributor: {
    githubUsername: 'test',
    account: {
      address: randomAddress(),
      network: 'localtest'
    }
  },
  pullRequestRepo: 'test',
  pullRequestNumber: 1
}

describe("tip", () => {
  const polkadotApi = new ApiPromise({
    provider: new HttpProvider("http://localhost:9933"),
    types: { Address: "AccountId", LookupSource: "AccountId" },
  });

  const getUserBalance = async (userAddress: string) => {
    console.log('here2')
    const { data } = await polkadotApi.query.system.account(userAddress);
    return data.free.toBn();
  };

  beforeAll(async () => {
    await polkadotApi.isReady;
    console.log('here1')
  })

  test('read initial tipper balance', async () => {
    const balance = await getUserBalance(tipperAccount)
    assert(balance.gtn(0))
  })

  test('tips a user (gov1)', async () => {
    debugger;
    const initialBalance = await getUserBalance(tip.contributor.account.address)
    console.log({initialBalance: initialBalance.toString()})

    await tipUser(state, tip)

    const balance = await getUserBalance(tip.contributor.account.address)
    console.log({balance: balance.toString()})

  })
});
