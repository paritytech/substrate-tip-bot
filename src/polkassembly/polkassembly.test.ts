import "@polkadot/api-augment";
import { Keyring } from "@polkadot/api";
import type { KeyringPair } from "@polkadot/keyring/types";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import fetch from "node-fetch";
import { stringToU8a } from "@polkadot/util";

const ENDPOINT = "https://test.polkassembly.io/api/v1/";
// const ENDPOINT = "https://api.polkassembly.io/api/v1/";

describe("Polkassembly API integration", () => {
  let keyringPair: KeyringPair;

  beforeAll(async () => {
    await cryptoWaitReady();
    const keyring = new Keyring({ type: "sr25519" });
    keyringPair = keyring.addFromUri("//Bob");
  });

  test("We are not logged in initially", async () => {

  });

  test("Can log in using the seed phrase", async () => {
    const requestBody = {address: keyringPair.address}
    const result = await fetch(
      `${ENDPOINT}/auth/actions/addressLoginStart`,
      { headers: {"Content-Type": "application/json"},method: "POST", body: JSON.stringify(requestBody) }
    );
    expect(result.status).toEqual(200)
    const responseBody = await result.json()
    expect('signMessage' in responseBody)
    const signMessage = (responseBody.signMessage as string).substr(7, (responseBody.signMessage as string).length - 14)
    console.log({
      orig: responseBody.signMessage,
      signMessage
    })
    const messageInUint8Array = stringToU8a(responseBody.signMessage);
    const signedMessage = keyringPair.sign(messageInUint8Array);
    const signature = '0x' + Buffer.from(signedMessage).toString('hex');

    console.log({signMessage: responseBody.signMessage, messageInUint8Array, signedMessage, signature})

    const result2 = await fetch(
      `${ENDPOINT}/auth/actions/addressLogin`,
      { headers: {"Content-Type": "application/json"},method: "POST", body: JSON.stringify({address: keyringPair.address, signature, wallet: "polkadot-js"}) }
    );
    console.log(result2)
    expect(result2.status).toEqual(200)
    const responseBody2 = await result2.json()
    expect('token' in responseBody2)
  });
});
