/*
This is an E2E test for an opengov tip,
from the point of creating a tip,
all the way to completing the referendum.
 */

import { until } from "@eng-automation/js";
import { ConvictionVotingVoteAccountVote, localrococo, MultiAddress } from "@polkadot-api/descriptors";
import { DEV_PHRASE } from "@polkadot-labs/hdkd-helpers";
import assert from "assert";
import { createClient, PolkadotClient, PolkadotSigner, TypedApi } from "polkadot-api";
import { WebSocketProvider } from "polkadot-api/ws-provider/node";

import { generateSigner } from "./bot-initialize";
import { papiConfig, rococoConstants } from "./chain-config";
import { randomAddress } from "./testUtil";
import { tipUser } from "./tip";
import { State, TipRequest } from "./types";
import { filter, firstValueFrom, mergeMap, pairwise, race, skip, throwError } from "rxjs";

const logMock: any = console.log.bind(console); // eslint-disable-line @typescript-eslint/no-explicit-any
logMock.error = console.error.bind(console);

const tipperAccount = "14E5nqKAp3oAJcmzgZhUD2RcptBeUBScxKHgJKU4HPNcKVf3"; // Bob
const treasuryAccount = "13UVJyLnbVp9RBZYFwFGyDvVd1y27Tt8tkntv6Q7JVPhFsTB"; // https://wiki.polkadot.network/docs/learn-account-advanced#system-accounts

const network = "localrococo";

const aliceMnemonic = `${DEV_PHRASE}//Alice`;
const bobMnemonic = `${DEV_PHRASE}//Bob`;

const expectBalanceIncrease = async (useraddress: string, api: TypedApi<typeof localrococo>, blocksNum: number) =>
  await firstValueFrom(
    race([
      api.query.System.Account.watchValue(useraddress, "best")
        .pipe(pairwise())
        .pipe(filter(([oldValue, newValue]) => newValue.data.free > oldValue.data.free)),
      api.query.System.Number.watchValue("best").pipe(
        skip(blocksNum),
        mergeMap(() =>
          throwError(() => new Error(`Balance of ${useraddress} did not increase in ${blocksNum} blocks`)),
        ),
      ),
    ]),
  );

describe("E2E opengov tip", () => {
  let state: State;
  let api: TypedApi<typeof localrococo>;
  let alice: PolkadotSigner;
  let client: PolkadotClient;

  beforeAll(() => {
    const jsonRpcProvider = WebSocketProvider(papiConfig.entries[network].wsUrl);
    client = createClient(jsonRpcProvider);
    api = client.getTypedApi(localrococo);
  });

  afterAll(() => {
    client.destroy();
  });

  const getUserBalance = async (userAddress: string): Promise<bigint> => {
    const wat = await api.constants.Referenda.Tracks();
    const { data } = await api.query.System.Account.getValue(userAddress, { at: "best" });
    return data.free;
  };

  beforeAll(async () => {
    try {
      await client.getFinalizedBlock();
    } catch (e) {
      console.log(
        `For these integrations tests, we're expecting local Rococo on ${
          papiConfig.entries[network].wsUrl
        }. Please refer to the Readme.`,
      );
    }

    assert((await getUserBalance(tipperAccount)) >= 0n);
    state = {
      allowedGitHubOrg: "test",
      allowedGitHubTeam: "test",
      botTipAccount: generateSigner(bobMnemonic),
      bot: { log: logMock } as any, // eslint-disable-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    };
    alice = generateSigner(aliceMnemonic);

    // In some local dev chains, treasury is broke, so we fund it.
    await api.tx.Balances.transfer_keep_alive({
      dest: MultiAddress.Id(treasuryAccount),
      value: 10000000000000n,
    }).signAndSubmit(alice);
  });

  test("Small OpenGov tip", async () => {
    const referendumId = await api.query.Referenda.ReferendumCount.getValue(); // The next free referendum index.
    const tipRequest: TipRequest = {
      tip: { size: "small" },
      contributor: { githubUsername: "test", account: { address: randomAddress(), network } },
      pullRequestRepo: "test",
      pullRequestNumber: 1,
    };
    // It is a random new address, so we expect the balance to be zero initially.
    expect(await getUserBalance(tipRequest.contributor.account.address)).toEqual(0n);

    // We place the tip proposal.
    const result = await tipUser(state, tipRequest);
    expect(result.success).toBeTruthy();

    // Alice votes "aye" on the referendum.
    await api.tx.Referenda.place_decision_deposit({ index: referendumId }).signAndSubmit(alice);
    await api.tx.ConvictionVoting.vote({
      poll_index: referendumId,
      vote: ConvictionVotingVoteAccountVote.Standard({ balance: 1_000_000n, vote: 1 }), // TODO: doublecheck {vote: 1}
    }).signAndSubmit(alice);

    // Waiting for the referendum voting, enactment, and treasury spend period.
    await expectBalanceIncrease(tipRequest.contributor.account.address, api, 9);

    // At the end, the balance of the contributor should increase by the KSM small tip amount.
    const expectedTip = BigInt(rococoConstants.namedTips.small) * 10n ** BigInt(rococoConstants.decimals);
    expect(await getUserBalance(tipRequest.contributor.account.address)).toEqual(expectedTip);
  });
});
