/*
This is an E2E test for an opengov tip,
from the point of creating a tip,
all the way to completing the referendum.
 */

import "@polkadot/api-augment";
import { until } from "@eng-automation/js";
import { ApiPromise, Keyring, WsProvider } from "@polkadot/api";
import type { SubmittableExtrinsic } from "@polkadot/api/types";
import { KeyringPair } from "@polkadot/keyring/types";
import { BN } from "@polkadot/util";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import assert from "assert";

import { getChainConfig, rococoConstants } from "./chain-config";
import { randomAddress } from "./testUtil";
import { tipUser } from "./tip";
import { State, TipRequest } from "./types";
import { generateSigner } from "./bot-initialize";
import { PolkadotSigner } from "polkadot-api";

const logMock: any = console.log.bind(console); // eslint-disable-line @typescript-eslint/no-explicit-any
logMock.error = console.error.bind(console);

const tipperAccount = "14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3"; // Bob
const treasuryAccount = "13UVJyLnbVp9RBZYFwFGyDvVd1y27Tt8tkntv6Q7JVPhFsTB"; // https://wiki.polkadot.network/docs/learn-account-advanced#system-accounts

const network = "localrococo";

const signAndSend = (signer: PolkadotSigner, extrinsic: SubmittableExtrinsic<"promise">) =>
  new Promise<void>(async (resolve, reject) => {
    try {
      await extrinsic.signAndSend(signer, { nonce: -1 }, (result) => {
        if (result.isError) {
          reject(result.status.toString());
        }
        if (result.isInBlock) {
          resolve();
        }
      });
    } catch (e) {
      reject(e);
    }
  });

describe("E2E opengov tip", () => {
  let state: State;
  let api: ApiPromise;
  let alice: PolkadotSigner;

  beforeAll(() => {
    api = new ApiPromise({
      provider: new WsProvider(getChainConfig(network).providerEndpoint),
      types: { Address: "AccountId", LookupSource: "AccountId" },
    });
  });

  afterAll(async () => {
    await api.disconnect();
  });

  const getUserBalance = async (userAddress: string) => {
    const { data } = await api.query.system.account(userAddress);
    return data.free.toBn();
  };

  beforeAll(async () => {
    await cryptoWaitReady();
    const keyring = new Keyring({ type: "sr25519" });
    try {
      await api.isReadyOrError;
    } catch (e) {
      console.log(
        `For these integrations tests, we're expecting local Rococo on ${
          getChainConfig(network).providerEndpoint
        }. Please refer to the Readme.`,
      );
    }

    assert((await getUserBalance(tipperAccount)).gtn(0));
    state = {
      allowedGitHubOrg: "test",
      allowedGitHubTeam: "test",
      botTipAccount: generateSigner("//Bob"),
      bot: { log: logMock } as any, // eslint-disable-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    };
    alice = generateSigner("//Alice");

    // In some local dev chains, treasury is broke, so we fund it.
    await signAndSend(alice, api.tx.balances.transferKeepAlive(treasuryAccount, new BN("10000000000000")));
  });

  test("Small OpenGov tip", async () => {
    const referendumId = await api.query.referenda.referendumCount(); // The next free referendum index.
    const tipRequest: TipRequest = {
      tip: { size: "small" },
      contributor: { githubUsername: "test", account: { address: randomAddress(), network } },
      pullRequestRepo: "test",
      pullRequestNumber: 1,
    };
    // It is a random new address, so we expect the balance to be zero initially.
    expect((await getUserBalance(tipRequest.contributor.account.address)).eqn(0)).toBeTruthy();

    // We place the tip proposal.
    const result = await tipUser(state, tipRequest);
    expect(result.success).toBeTruthy();

    // Alice votes "aye" on the referendum.
    await signAndSend(alice, api.tx.referenda.placeDecisionDeposit(referendumId));
    await signAndSend(
      alice,
      api.tx.convictionVoting.vote(referendumId, {
        Standard: { balance: new BN(1_000_000), vote: { aye: true, conviction: 1 } },
      }),
    );

    // Waiting for the referendum voting, enactment, and treasury spend period.
    await until(async () => (await getUserBalance(tipRequest.contributor.account.address)).gtn(0), 5000, 50);

    // At the end, the balance of the contributor should increase by the KSM small tip amount.
    const expectedTip = new BN(rococoConstants.namedTips.small).mul(new BN("10").pow(new BN(rococoConstants.decimals)));
    expect((await getUserBalance(tipRequest.contributor.account.address)).eq(expectedTip)).toBeTruthy();
  });
});
