import "@polkadot/api-augment";
import { Wallet } from "ethers";

import { Polkassembly } from "./polkassembly";

/**
 * This is a test suite that uses the production (non-test) Polkassembly API,
 * and a Moonbase Alpha testnet to perform a single test case that
 * creates a referendum and edits the metadata on Polkassembly.
 *
 * Moonbase is an EVM-compatible chain, so we're using an Ethereum signer.
 * Currently, it's the only testnet with OpenGov and Polkassembly support.
 * Related: https://github.com/paritytech/substrate-tip-bot/issues/46
 *
 * The tests are mostly manual because the code doesn't support sending
 * Ethereum-signed blockchain transactions (only Ethereum-signed Polkassembly API calls).
 * Also, Moonbase Alpha doesn't have the tipper tracks.
 *
 * To run:
 * 1. Create a Moonbase Alpha account
 * 2. Fund it (upwards of 20 DEV are needed)
 * 3. Manually (in polkadot.js.org/apps) create a preimage and a referendum.
 * Use any tack, for example Root. Tipper tracks are not available.
 * 4. Un-skip the test, and edit the variables below.
 */
describe("Polkassembly with production API and Moonbase Alpha testnet", () => {
  let polkassembly: Polkassembly;
  const moonbaseMnemonic: string | undefined = undefined; // Edit before running.
  const manuallyCreatedReferendumId: number | undefined = undefined; // Edit before running

  beforeAll(() => {
    if (moonbaseMnemonic === undefined || manuallyCreatedReferendumId === undefined) {
      throw new Error("Variables needed. Read description above.");
    }
    const wallet = Wallet.fromMnemonic(moonbaseMnemonic);
    polkassembly = new Polkassembly("https://api.polkassembly.io/api/v1/", { type: "ethereum", wallet });
  });

  test.skip("Edits a metadata of an existing referendum", async () => {
    await polkassembly.loginOrSignup();
    await polkassembly.editPost("moonbase", {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      postId: manuallyCreatedReferendumId!,
      proposalType: "referendums_v2",
      content: `Just testing, feel free to vote nay.\nToday is ${new Date().toISOString()}`,
      title: "A mock referendum",
    });
  });
});
