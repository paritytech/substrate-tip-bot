import "@polkadot/api-augment";
import { Keyring } from "@polkadot/api";
import type { KeyringPair } from "@polkadot/keyring/types";
import { cryptoWaitReady, randomAsU8a } from "@polkadot/util-crypto";
import { logMock } from "#src/testUtil";

import { Polkassembly } from "./polkassembly";
import { generateSigner } from "#src/bot-initialize";
import { PolkadotSigner } from "polkadot-api";

const network = "moonbase";

describe("Polkassembly with a test endpoint", () => {
  let keyringPair: PolkadotSigner;
  let polkassembly: Polkassembly;

  beforeAll(async () => {
    await cryptoWaitReady();
  });

  beforeEach(() => {
    const keyring = new Keyring({ type: "sr25519" });
    // A random account for every test.
    keyringPair = generateSigner(new TextDecoder().decode(randomAsU8a(32)));
    polkassembly = new Polkassembly("https://test.polkassembly.io/api/v1/", { type: "polkadot", keyringPair }, logMock);
  });

  test("Can produce a signature", async () => {
    await polkassembly.signMessage("something");
  });

  test("We are not logged in initially", () => {
    expect(polkassembly.loggedIn).toBeFalsy();
  });

  test("We cannot log in without signing up first", async () => {
    await expect(() => polkassembly.login(network)).rejects.toThrowError(
      "Please sign up prior to logging in with a web3 address",
    );
  });

  test("Can sign up", async () => {
    await polkassembly.signup(network);
    expect(polkassembly.loggedIn).toBeTruthy();
  });

  test("Can log in and logout, having signed up", async () => {
    await polkassembly.signup(network);
    expect(polkassembly.loggedIn).toBeTruthy();

    polkassembly.logout();
    expect(polkassembly.loggedIn).toBeFalsy();

    await polkassembly.login(network);
    expect(polkassembly.loggedIn).toBeTruthy();
  });

  test("Cannot sign up twice", async () => {
    await polkassembly.signup(network);
    expect(polkassembly.loggedIn).toBeTruthy();

    polkassembly.logout();
    expect(polkassembly.loggedIn).toBeFalsy();

    await expect(() => polkassembly.signup(network)).rejects.toThrowError(
      "There is already an account associated with this address, you cannot sign-up with this address",
    );
    expect(polkassembly.loggedIn).toBeFalsy();
  });

  test("Login-or-signup handles it all", async () => {
    expect(polkassembly.loggedIn).toBeFalsy();

    // Will sign up.
    await polkassembly.loginOrSignup(network);
    expect(polkassembly.loggedIn).toBeTruthy();

    // Won't throw an error when trying again.
    await polkassembly.loginOrSignup(network);
    expect(polkassembly.loggedIn).toBeTruthy();

    // Can log out.
    polkassembly.logout();
    expect(polkassembly.loggedIn).toBeFalsy();

    // Can log back in.
    await polkassembly.loginOrSignup(network);
    expect(polkassembly.loggedIn).toBeTruthy();

    // Can relog to a different network.
    await polkassembly.loginOrSignup("kusama");
    expect(polkassembly.loggedIn).toBeTruthy();
  });

  test("Can retrieve a last referendum number on a track", async () => {
    const result = await polkassembly.getLastReferendumNumber("moonbase", 0);
    expect(typeof result).toEqual("number");
    expect(result).toBeGreaterThan(0);
  });
});
