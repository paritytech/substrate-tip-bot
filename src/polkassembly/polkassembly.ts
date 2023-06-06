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
        wallet: "polkadot-js",
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

  public async createPost(
    network: string,
    opts: {
      title: string;
      content: string;
      proposalType: "referendums_v2";
    },
  ): Promise<void> {
    await this.startAndConfirm({
      network,
      startAction: "createPostStart",
      confirmAction: "createPostConfirm",
      confirmActionBody: opts,
    });
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
      console.log(response.statusText);
      process.exit(1);
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

  /**
   * The API has a pattern of "starting" an action,
   * getting a message to sign,
   * and then "confirming" the action with a signature.
   */
  private async startAndConfirm(opts: {
    startAction: string;
    confirmAction: string;
    confirmActionBody: Record<string, unknown>;
    network: string;
  }): Promise<unknown> {
    const { startAction, confirmAction, confirmActionBody, network } = opts;
    const startResponse = await fetch(`${this.endpoint}/auth/actions/${startAction}`, {
      headers,
      method: "POST",
      body: JSON.stringify({ address: this.address }),
    });
    if (!startResponse.ok) {
      throw new Error(await startResponse.text());
    }
    const startBody = (await startResponse.json()) as { signMessage: string };

    const confirmResponse = await fetch(`${this.endpoint}/auth/actions/${confirmAction}`, {
      headers: { ...headers, "x-network": network },
      method: "POST",
      body: JSON.stringify({
        ...confirmActionBody,
        address: this.address,
        signature: await this.signMessage(startBody.signMessage),
      }),
    });
    if (!confirmResponse.ok) {
      console.log(confirmResponse.status);
      console.log(confirmResponse.statusText);
      console.log(await confirmResponse.text());
      throw new Error(await confirmResponse.text());
    }
    return await confirmResponse.json();
  }

  // public async getRecentR

  public async signMessage(message: string): Promise<string> {
    const messageInUint8Array = stringToU8a(message);
    if (this.signer.type === "ethereum") {
      return await this.signer.wallet.signMessage(message);
      /* console.log({
           signed,
           len: signed.length,
           sig: ethers.utils.splitSignature(flatSig);
         }) */
    }
    const signedMessage = this.signer.keyringPair.sign(messageInUint8Array);
    console.log({ signedMessage, str: signedMessage.toString(), len: signedMessage.length });
    return "0x" + Buffer.from(signedMessage).toString("hex");
  }
}
