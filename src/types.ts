import { KeyringPair } from "@polkadot/keyring/types";
import { BN } from "@polkadot/util";
import type { MatrixClient } from "matrix-js-sdk";
import { Probot } from "probot";

import { Polkassembly } from "./polkassembly/polkassembly";

export type TipNetwork = "localkusama" | "localpolkadot" | "kusama" | "polkadot";

export type TipSize = "small" | "medium" | "large";
export type OpenGovTrack = { trackNo: number; trackName: string };
export const SmallTipperTrack: OpenGovTrack = { trackNo: 30, trackName: "SmallTipper" };
export const BigTipperTrack: OpenGovTrack = { trackNo: 31, trackName: "BigTipper" };

export type ChainConfig = {
  providerEndpoint: string;
  decimals: number;
  currencySymbol: string;
  smallTipperMaximum: number;
  bigTipperMaximum: number;
  namedTips: Record<TipSize, number>;
};

export type ContributorAccount = {
  address: string;
  network: TipNetwork;
};

export type Contributor = {
  githubUsername: string;
  account: ContributorAccount;
};

export type State = {
  allowedGitHubOrg: string;
  allowedGitHubTeam: string;
  botTipAccount: KeyringPair;
  bot: Probot;
  polkassembly?: Polkassembly | undefined;
  matrix?:
    | {
        client: MatrixClient;
        roomId: string;
      }
    | undefined;
};

export type TipRequest = {
  contributor: Contributor;
  pullRequestNumber: number;
  pullRequestRepo: string;
  tip: {
    size: TipSize | BN;
  };
};

export type TipResult =
  | { success: true; tipUrl: string; blockHash: string }
  | { success: false; errorMessage?: string };
