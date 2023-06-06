import { KeyringPair } from "@polkadot/keyring/types";
import { stringToU8a } from "@polkadot/util";
import { Wallet } from "ethers";
import fetch from "node-fetch";

const headers = { "Content-Type": "application/json" };

export class Polkassembly {
  private token: string | undefined;

  constructor(
    private endpoint: string,
    private signer: { type: "polkadot"; keyringPair: KeyringPair } | { type: "ethereum"; wallet: Wallet }, // For example, to be used with Moonbase Alpha.
  ) {}

  public get loggedIn(): boolean {
    return this.token !== undefined;
  }

  public get address(): string {
    return this.signer.type === "polkadot" ? this.signer.keyringPair.address : this.signer.wallet.address;
  }

  public async signup(): Promise<void> {
    if (this.loggedIn) return;
    const signupStartResponse = await fetch(`${this.endpoint}/auth/actions/addressSignupStart`, {
      headers,
      method: "POST",
      body: JSON.stringify({ address: this.address }),
    });
    if (!signupStartResponse.ok) {
      throw new Error(await signupStartResponse.text());
    }
    const signupStartBody = (await signupStartResponse.json()) as { signMessage: string };

    const signupResponse = await fetch(`${this.endpoint}/auth/actions/addressSignupConfirm`, {
      headers,
      method: "POST",
      body: JSON.stringify({
        address: this.address,
        signature: await this.signMessage(signupStartBody.signMessage),
        wallet: this.signer.type === "polkadot" ? "polkadot-js" : "metamask",
      }),
    });
    if (!signupResponse.ok) {
      throw new Error(await signupResponse.text());
    }
    const signupBody = (await signupResponse.json()) as { token: string };
    if (!signupBody.token) {
      throw new Error("Signup unsuccessful, the authentication token is missing.");
    }
    this.token = signupBody.token;
  }

  public async login(): Promise<void> {
    if (this.loggedIn) return;

    const loginStartResponse = await fetch(`${this.endpoint}/auth/actions/addressLoginStart`, {
      headers,
      method: "POST",
      body: JSON.stringify({ address: this.address }),
    });
    if (!loginStartResponse.ok) {
      throw new Error(await loginStartResponse.text());
    }
    const loginStartBody = (await loginStartResponse.json()) as { signMessage: string };

    const loginResponse = await fetch(`${this.endpoint}/auth/actions/addressLogin`, {
      headers,
      method: "POST",
      body: JSON.stringify({
        address: this.address,
        signature: await this.signMessage(loginStartBody.signMessage),
        wallet: this.signer.type === "polkadot" ? "polkadot-js" : "metamask",
      }),
    });
    if (!loginResponse.ok) {
      throw new Error(await loginResponse.text());
    }
    const loginBody = (await loginResponse.json()) as { token: string };
    if (!loginBody.token) {
      throw new Error("Login unsuccessful, the authentication token is missing.");
    }
    this.token = loginBody.token;
  }

  public logout(): void {
    this.token = undefined;
  }

  public async loginOrSignup(): Promise<void> {
    try {
      await this.login();
    } catch (e) {
      if ((e as Error).message.includes("Please sign up")) {
      }
      await this.signup();
    }
  }

  public async editPost(
    network: string,
    opts: {
      postId: number;
      title: string;
      content: string;
      proposalType: "referendums_v2";
    },
  ): Promise<void> {
    if (!this.token) {
      throw new Error("Not logged in.");
    }
    const response = await fetch(`${this.endpoint}/auth/actions/editPost`, {
      headers: { ...headers, "x-network": network, authorization: `Bearer ${this.token}` },
      method: "POST",
      body: JSON.stringify(opts),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const body: unknown = await response.json();
    console.log(JSON.stringify(body, undefined, 2));
  }

  async getLastReferendumNumber(trackNo: number): Promise<number | undefined> {
    const response = await fetch(
      `${this.endpoint}/listing/on-chain-posts?proposalType=referendums_v2&trackNo=${trackNo}&sortBy=newest`,
      { headers: { ...headers, "x-network": "moonbase" }, method: "POST", body: JSON.stringify({}) },
    );
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const body = (await response.json()) as { posts: { post_id: number }[] };
    return body.posts[0]?.post_id;
  }

  public async signMessage(message: string): Promise<string> {
    const messageInUint8Array = stringToU8a(message);
    if (this.signer.type === "ethereum") {
      return await this.signer.wallet.signMessage(message);
    }
    const signedMessage = this.signer.keyringPair.sign(messageInUint8Array);
    return "0x" + Buffer.from(signedMessage).toString("hex");
  }
}
