import { ss58Address } from "@polkadot-labs/hdkd-helpers";
import { Wallet } from "ethers";
import { PolkadotSigner } from "polkadot-api";
import type { Probot } from "probot";

const headers = { "Content-Type": "application/json" };

export class Polkassembly {
  private loggedInData: { token: string; network: string } | undefined = undefined;

  private get token(): string | undefined {
    return this.loggedInData?.token;
  }

  private get network(): string | undefined {
    return this.loggedInData?.network;
  }

  constructor(
    private endpoint: string,
    private signer: { type: "polkadot"; keyringPair: PolkadotSigner } | { type: "ethereum"; wallet: Wallet }, // Ethereum type is used for EVM chains.
    private log: Probot["log"],
  ) {}

  public get loggedIn(): boolean {
    return this.loggedInData !== undefined;
  }

  public get address(): string {
    return this.signer.type === "polkadot"
      ? ss58Address(this.signer.keyringPair.publicKey)
      : this.signer.wallet.address;
  }

  public async signup(network: string): Promise<void> {
    if (this.loggedIn && this.network === network) {
      this.log("Already logged in to Polkassembly - signup is skipped.");
      return;
    }
    if (this.loggedIn && this.network !== network) {
      this.log("Already logged in to Polkassembly but on different network - signing up and relogging.");
      this.logout();
    }
    this.log("Signing up to Polkassembly...");
    const signupStartResponse = await fetch(`${this.endpoint}/auth/actions/addressSignupStart`, {
      headers: { ...headers, "x-network": network },
      method: "POST",
      body: JSON.stringify({ address: this.address }),
    });
    if (!signupStartResponse.ok) {
      this.log.error(`addressSignupStart failed with status code ${signupStartResponse.status}`);
      throw new Error(await signupStartResponse.text());
    }
    const signupStartBody = (await signupStartResponse.json()) as { signMessage: string };

    const signupResponse = await fetch(`${this.endpoint}/auth/actions/addressSignupConfirm`, {
      headers: { ...headers, "x-network": network },
      method: "POST",
      body: JSON.stringify({
        address: this.address,
        signature: await this.signMessage(signupStartBody.signMessage),
        wallet: this.signer.type === "polkadot" ? "polkadot-js" : "metamask",
      }),
    });
    if (!signupResponse.ok) {
      this.log.error(`addressSignupConfirm failed with status code ${signupResponse.status}`);
      throw new Error(await signupResponse.text());
    }
    const signupBody = (await signupResponse.json()) as { token: string };
    if (!signupBody.token) {
      throw new Error("Signup unsuccessful, the authentication token is missing.");
    }
    this.loggedInData = { token: signupBody.token, network };
    this.log.info("Polkassembly sign up successful.");
  }

  public async login(network: string): Promise<void> {
    if (this.loggedIn && this.network === network) {
      this.log("Already logged in to Polkassembly - login is skipped.");
      return;
    }
    if (this.loggedIn && this.network !== network) {
      this.log("Already logged in to Polkassembly but on different network - relogging.");
      this.logout();
    }

    this.log("Logging in to Polkassembly...");

    const loginStartResponse = await fetch(`${this.endpoint}/auth/actions/addressLoginStart`, {
      headers: { ...headers, "x-network": network },
      method: "POST",
      body: JSON.stringify({ address: this.address }),
    });
    if (!loginStartResponse.ok) {
      this.log.error(`addressLoginStart failed with status code ${loginStartResponse.status}`);
      throw new Error(await loginStartResponse.text());
    }
    const loginStartBody = (await loginStartResponse.json()) as { signMessage: string };

    const loginResponse = await fetch(`${this.endpoint}/auth/actions/addressLogin`, {
      headers: { ...headers, "x-network": network },
      method: "POST",
      body: JSON.stringify({
        address: this.address,
        signature: await this.signMessage(loginStartBody.signMessage),
        wallet: this.signer.type === "polkadot" ? "polkadot-js" : "metamask",
      }),
    });
    if (!loginResponse.ok) {
      this.log.error(`addressLogin failed with status code ${loginResponse.status}`);
      throw new Error(await loginResponse.text());
    }
    const loginBody = (await loginResponse.json()) as { token: string };
    if (!loginBody.token) {
      this.log.error("Login to Polkassembly failed, the token was not found in response body");
      this.log.info(`Available response body fields: ${Object.keys(loginBody).join(",")}`);
      throw new Error("Login unsuccessful, the authentication token is missing.");
    }
    this.loggedInData = { token: loginBody.token, network };
    this.log.info("Polkassembly login successful.");
  }

  public logout(): void {
    this.loggedInData = undefined;
  }

  public async loginOrSignup(network: string): Promise<void> {
    try {
      await this.login(network);
    } catch (e) {
      if ((e as Error).message.includes("Please sign up")) {
        await this.signup(network);
      } else {
        this.log.error(e, "loginOrSignup to Polkassembly failed.");
        throw e;
      }
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
      this.log.error("Attempted to edit Polkassembly post without logging in.");
      throw new Error("Not logged in.");
    }
    const body = {
      ...opts,
      // GENERAL from https://github.com/polkassembly/polkassembly/blob/670f3ab9dae95ccb9a293f8cadfa409620604abf/src/global/post_topics.ts
      topicId: 5,
    };
    const response = await fetch(`${this.endpoint}/auth/actions/editPost`, {
      headers: { ...headers, "x-network": network, authorization: `Bearer ${this.token}` },
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      this.log.error(`editPost failed with status code ${response.status}`);
      throw new Error(await response.text());
    }
    this.log.info("Polkassembly post editing successful.");
  }

  async getLastReferendumNumber(network: string, trackNo: number): Promise<number | undefined> {
    const response = await fetch(
      `${this.endpoint}/listing/on-chain-posts?proposalType=referendums_v2&trackNo=${trackNo}&sortBy=newest`,
      { headers: { ...headers, "x-network": network }, method: "POST", body: JSON.stringify({}) },
    );
    if (!response.ok) {
      this.log.error(`listing/on-chain-posts failed with status code ${response.status}`);
      throw new Error(await response.text());
    }
    const body = (await response.json()) as { posts: { post_id: number }[] };
    const result = body.posts[0]?.post_id;
    this.log.info(`Most recent referendum id on Polkassembly is: ${result}`);
    return result;
  }

  public async signMessage(message: string): Promise<string> {
    const messageInUint8Array: Uint8Array = Buffer.from(message);
    if (this.signer.type === "ethereum") {
      return await this.signer.wallet.signMessage(message);
    }
    const signedMessage: Uint8Array = await this.signer.keyringPair.signBytes(messageInUint8Array);
    return "0x" + Buffer.from(signedMessage).toString("hex");
  }
}
