import { GovernanceOrigin } from "@polkadot-api/descriptors";
import type { MatrixClient } from "matrix-js-sdk";
import { PolkadotSigner } from "polkadot-api";
import { Probot } from "probot";

import { Polkassembly } from "./polkassembly/polkassembly";

export type TipNetwork = "kusama" | "polkadot" | "rococo" | "westend";

export type TipSize = "small" | "medium" | "large";

// explicitly narrowing values to "SmallTipper" | "BigTipper", in order to get around network differences
export type OpenGovTrack = { trackNo: number; trackName: { type: "SmallTipper" | "BigTipper" } };
export const SmallTipperTrack: OpenGovTrack = { trackNo: 30, trackName: GovernanceOrigin.SmallTipper() };
export const BigTipperTrack: OpenGovTrack = { trackNo: 31, trackName: GovernanceOrigin.BigTipper() };

export type ChainConfig = {
  decimals: bigint;
  currencySymbol: string;
  smallTipperMaximum: number;
  bigTipperMaximum: number;
  namedTips: Record<TipSize, bigint>;
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
  botTipAccount: PolkadotSigner;
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
  pullRequestOwner: string;
  tip: {
    size: TipSize | bigint;
  };
};

export type TipResult =
  | {
      success: true;
      referendumNumber: number | null;
      blockHash: string;
      track: OpenGovTrack;
      value: bigint;
    }
  | { success: false; errorMessage: string };

// https://docs.github.com/en/rest/reactions/reactions#about-reactions
export type GithubReactionType = "+1" | "-1" | "laugh" | "confused" | "heart" | "hooray" | "rocket" | "eyes";
