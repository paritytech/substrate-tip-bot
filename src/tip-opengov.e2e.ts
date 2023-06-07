/*
This is an E2E test for an opengov tip,
from the point of creating a tip,
all the way to completing the referendum.
 */

import "@polkadot/api-augment";
import { ApiPromise, Keyring, WsProvider } from "@polkadot/api";
import { createTestKeyring } from "@polkadot/keyring";
import { KeyringPair } from "@polkadot/keyring/types";
import { BN } from "@polkadot/util";
import { cryptoWaitReady, randomAsU8a } from "@polkadot/util-crypto";
import assert from "assert";

import { getChainConfig } from "./chain-config";
import { tipUser } from "./tip";
import { State, TipRequest } from "./types";

const randomAddress = () => createTestKeyring().addFromSeed(randomAsU8a(32)).address;

const logMock: any = console.log.bind(console); // eslint-disable-line @typescript-eslint/no-explicit-any
logMock.error = console.error.bind(console);

const tipperAccount = "14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3"; // Bob

describe("E2E opengov tip", () => {
  let state: State;
  let kusamaApi: ApiPromise;
  let alice: KeyringPair;

  beforeAll(() => {
    kusamaApi = new ApiPromise({
      provider: new WsProvider(getChainConfig("localkusama").providerEndpoint),
      types: { Address: "AccountId", LookupSource: "AccountId" },
    });
  });

  afterAll(async () => {
    await kusamaApi.disconnect();
  });

  const getUserBalance = async (userAddress: string) => {
    const { data } = await kusamaApi.query.system.account(userAddress);
    return data.free.toBn();
  };

  beforeAll(async () => {
    await cryptoWaitReady();
    const keyring = new Keyring({ type: "sr25519" });
    try {
      await kusamaApi.isReadyOrError;
    } catch (e) {
      console.log(
        `For these integrations tests, we're expecting local Kusama on ${
          getChainConfig("localkusama").providerEndpoint
        }. Please refer to the Readme.`,
      );
    }

    assert((await getUserBalance(tipperAccount)).gtn(0));
    state = {
      allowedGitHubOrg: "test",
      allowedGitHubTeam: "test",
      botTipAccount: keyring.addFromUri("//Bob"),
      bot: { log: logMock } as any, // eslint-disable-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    };
    alice = keyring.addFromUri("//Alice");
  });

  test("Small OpenGov tip", async () => {
    const referendumId = await kusamaApi.query.referenda.referendumCount(); // The next free referendum index.
    const tipRequest: TipRequest = {
      tip: { size: "small" },
      contributor: { githubUsername: "test", account: { address: randomAddress(), network: "localkusama" } },
      pullRequestRepo: "test",
      pullRequestNumber: 1,
    };
    // It is a random new address, so we expect the balance to be zero initially.
    expect((await getUserBalance(tipRequest.contributor.account.address)).eqn(0)).toBeTruthy();

    // We place the tip proposal.
    const result = await tipUser(state, tipRequest);
    expect(result.success).toBeTruthy();

    // Alice votes "aye" on the referendum.
    await kusamaApi.tx.referenda.placeDecisionDeposit(referendumId).signAndSend(alice, { nonce: -1 });
    await kusamaApi.tx.convictionVoting
      .vote(referendumId, { Standard: { balance: new BN(1_000_000), vote: { aye: true, conviction: 1 } } })
      .signAndSend(alice, { nonce: -1 });

    // Going to sleep for 5 minutes, waiting for the referendum voting, enactment, and treasury spend period.
    await new Promise((res) => setTimeout(res, 5 * 60_000));

    // At the end, the balance of the contributor should increase.
    expect((await getUserBalance(tipRequest.contributor.account.address)).eq(new BN("2000000000000"))).toBeTruthy();
  });
});
