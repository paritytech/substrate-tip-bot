import assert from "assert";

import { OPENGOV_LARGE_TIP_VALUE, OPENGOV_MEDIUM_TIP_VALUE, OPENGOV_SMALL_TIP_VALUE } from "./constants";
import { ContributorAccount, OpenGovTrack, TipNetwork, TipRequest, TipSize } from "./types";

const validTipSizes: { [key: string]: TipSize } = { small: "small", medium: "medium", large: "large" } as const;

export function getTipSize(tipSizeInput: string | undefined): TipSize {
  if (!tipSizeInput || !(tipSizeInput in validTipSizes)) {
    throw new Error(`Invalid tip size. Please specify one of ${Object.keys(validTipSizes).join(", ")}.`);
  }

  return validTipSizes[tipSizeInput];
}

export function tipSizeToOpenGovTrack(tipSize: TipSize): { track: OpenGovTrack; value: number } {
  if (tipSize === "small") return { track: "SmallTipper", value: OPENGOV_SMALL_TIP_VALUE };
  if (tipSize === "medium") return { track: "BigTipper", value: OPENGOV_MEDIUM_TIP_VALUE };
  if (tipSize === "large") return { track: "BigTipper", value: OPENGOV_LARGE_TIP_VALUE };

  throw new Error(`Invalid tip size. Please specify one of ${Object.keys(validTipSizes).join(", ")}.`);
}

export function parseContributorAccount(pullRequestBody: string | null): ContributorAccount {
  const matches =
    typeof pullRequestBody === "string" &&
    pullRequestBody.match(
      // match "polkadot address: <ADDRESS>"
      /(\S+)\s*address:\s*([a-z0-9]+)/i,
    );

  if (matches === false || matches === null || matches.length != 3) {
    throw new Error(
      `Contributor did not properly post their account address.\n\nMake sure the pull request description has: "{network} address: {address}".`,
    );
  }

  const [matched, networkInput, address] = matches;
  assert(networkInput, `networkInput could not be parsed from "${matched}"`);
  assert(address, `address could not be parsed from "${matched}"`);

  const validNetworks: { [key: string]: TipNetwork } = {
    polkadot: "polkadot",
    kusama: "kusama",
    localtest: "localtest",
  };

  const network =
    networkInput.toLowerCase() in validNetworks
      ? validNetworks[networkInput.toLowerCase() as keyof typeof validNetworks]
      : undefined;
  if (!network) {
    throw new Error(
      `Invalid network: "${networkInput}". Please select one of: ${Object.keys(validNetworks).join(", ")}.`,
    );
  }

  return { network, address };
}

export const formatReason = (tipRequest: TipRequest): string => {
  const { contributor, pullRequestNumber, pullRequestRepo, tip } = tipRequest;
  return `TO: ${contributor.githubUsername} FOR: ${pullRequestRepo}#${pullRequestNumber} (${tip.size})`;
};
