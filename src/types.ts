import { KeyringPair } from "@polkadot/keyring/types";
import { BN } from "@polkadot/util";
import { Probot } from "probot";

export type TipNetwork = "localkusama" | "localpolkadot" | "kusama" | "polkadot";

export type TipType = "treasury" | "opengov";
export type TipSize = "small" | "medium" | "large";
export type OpenGovTrack = "SmallTipper" | "BigTipper";

export type ChainConfig = {
  providerEndpoint: string;
  /**
   * This is dependent on which pallets the chain has.
   * The preferred type is OpenGov,
   * but some chains (Polkadot) do not support it (yet).
   */
  tipType: TipType;
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
};

export type TipRequest = {
  contributor: Contributor;
  pullRequestNumber: number;
  pullRequestRepo: string;
  tip: {
    size: TipSize | BN;
  };
};

export type TipResult = { success: true; tipUrl: string } | { success: false; errorMessage?: string };
