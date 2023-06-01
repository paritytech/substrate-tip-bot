import fetch from "node-fetch";
import { KeyringPair } from "@polkadot/keyring/types";
import { stringToU8a } from "@polkadot/util";

const headers = {"Content-Type": "application/json"}

export class Polkassembly {
  private token: string | undefined

  constructor(
    private endpoint: string,
    private keyringPair: KeyringPair
  ) {
  }

  public get loggedIn() {
    return this.token !== undefined
  }

  public async signup () {
    if (this.loggedIn) return
    const signupStartResponse = await fetch(
      `${this.endpoint}/auth/actions/addressSignupStart`,
      { headers, method: "POST", body: JSON.stringify({address: this.keyringPair.address}) }
    );
    if (!signupStartResponse.ok) {
      throw new Error(await signupStartResponse.text())
    }
    const signupStartBody = await signupStartResponse.json()

    const signupResponse = await fetch(
      `${this.endpoint}/auth/actions/addressSignupConfirm`,
      { headers, method: "POST", body: JSON.stringify({
          address: this.keyringPair.address,
          signature: this.signMessage(signupStartBody.signMessage as string),
          wallet: "polkadot-js",
      }) }
    );
    if (!signupResponse.ok) {
      throw new Error(await signupResponse.text())
    }
    const signupBody = await signupResponse.json()
    if (!signupBody.token) {
      throw new Error('Signup unsuccessful, the authentication token is missing.')
    }
    this.token = signupBody.token
  }

  public async login () {
    if (this.loggedIn) return

    const loginStartResponse = await fetch(
      `${this.endpoint}/auth/actions/addressLoginStart`,
      { headers, method: "POST", body: JSON.stringify({address: this.keyringPair.address}) }
    );
    if (!loginStartResponse.ok) {
      throw new Error(await loginStartResponse.text())
    }
    const loginStartBody = await loginStartResponse.json()

    const loginResponse = await fetch(
      `${this.endpoint}/auth/actions/addressLogin`,
      { headers, method: "POST", body: JSON.stringify({
          address: this.keyringPair.address,
          signature: this.signMessage(loginStartBody.signMessage as string),
          wallet: "polkadot-js"
      }) }
    );
    if (!loginResponse.ok) {
      throw new Error(await loginResponse.text())
    }
    const loginBody = await loginResponse.json()
    if (!loginBody.token) {
      throw new Error('Login unsuccessful, the authentication token is missing.')
    }
    this.token = loginBody.token
  }

  public async logout () {
    this.token = undefined
  }

  public async loginOrSignup () {
    try {
      await this.login()
    } catch(e: any) {
      if (e.message?.includes("Please sign up")) {}
      await this.signup()
    }
  }

  private signMessage (message: string): string {
    const messageInUint8Array = stringToU8a(message);
    const signedMessage = this.keyringPair.sign(messageInUint8Array);
    return '0x' + Buffer.from(signedMessage).toString('hex');
  }
}
