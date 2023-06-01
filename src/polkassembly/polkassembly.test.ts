import "@polkadot/api-augment";
import { Keyring } from "@polkadot/api";
import type { KeyringPair } from "@polkadot/keyring/types";
import { cryptoWaitReady, randomAsU8a } from "@polkadot/util-crypto";
import { Polkassembly } from "./polkassembly";

describe("Polkassembly API integration", () => {
  let keyringPair: KeyringPair;
  let polkassembly: Polkassembly;

  beforeAll(async () => {
    await cryptoWaitReady();
  });

  beforeEach(async () => {
    const keyring = new Keyring({ type: "sr25519" });
    // A random account for every test.
    keyringPair = keyring.addFromSeed(randomAsU8a(32));
    polkassembly = new Polkassembly("https://test.polkassembly.io/api/v1/", keyringPair)
  });

  test("We are not logged in initially", async () => {
    expect(polkassembly.loggedIn).toBeFalsy()
  });

  test("We cannot log in without signing up first", async () => {
    await expect(() => polkassembly.login()).rejects.toThrowError("Please sign up prior to logging in with a web3 address")
  })

  test("Can sign up", async () => {
    await polkassembly.signup()
    expect(polkassembly.loggedIn).toBeTruthy()
  })

  test("Can log in and logout, having signed up", async () => {
    await polkassembly.signup()
    expect(polkassembly.loggedIn).toBeTruthy()

    await polkassembly.logout()
    expect(polkassembly.loggedIn).toBeFalsy()

    await polkassembly.login()
    expect(polkassembly.loggedIn).toBeTruthy()
  });

  test("Cannot sign up on different networks with the same address", async () => {
    await polkassembly.signup()
    expect(polkassembly.loggedIn).toBeTruthy()

    await polkassembly.logout()
    expect(polkassembly.loggedIn).toBeFalsy()

    await expect(() => polkassembly.signup()).rejects.toThrowError("There is already an account associated with this address, you cannot sign-up with this address")
    expect(polkassembly.loggedIn).toBeFalsy()
  })

  test("Login-or-signup handles it all", async () => {
    expect(polkassembly.loggedIn).toBeFalsy()

    // Will sign up.
    await polkassembly.loginOrSignup()
    expect(polkassembly.loggedIn).toBeTruthy()

    // Won't throw an error when trying again.
    await polkassembly.loginOrSignup()
    expect(polkassembly.loggedIn).toBeTruthy()

    // Can log out.
    await polkassembly.logout()
    expect(polkassembly.loggedIn).toBeFalsy()

    // Can log back in.
    await polkassembly.loginOrSignup()
    expect(polkassembly.loggedIn).toBeTruthy()
  })
});
