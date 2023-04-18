import { KeyringPair } from "@polkadot/keyring/types";
import { Probot } from "probot";

export type TipNetwork = "localkusama" | "localpolkadot" | "kusama" | "polkadot";

export type TipSize = "small" | "medium" | "large";
export type OpenGovTrack = "SmallTipper" | "BigTipper";

export type ChainConfig = {
  providerEndpoint: string;
  tipUrl: string;
  decimals: number;
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
};

export type TipRequest = {
  contributor: Contributor;
  pullRequestNumber: number;
  pullRequestRepo: string;
  tip: {
    type: "treasury" | "opengov";
    size: TipSize;
  };
};

export type TipResult = { success: boolean; tipUrl: string };
