import { BN } from "@polkadot/util";
import assert from "assert";

import { getChainConfig } from "./chain-config";
import { ContributorAccount, OpenGovTrack, TipNetwork, TipRequest, TipSize } from "./types";

const validTipSizes: { [key: string]: TipSize } = { small: "small", medium: "medium", large: "large" } as const;
const validNetworks: { [key: string]: TipNetwork } = {
  polkadot: "polkadot",
  kusama: "kusama",
  localkusama: "localkusama",
  localpolkadot: "localpolkadot",
} as const;

export function getTipSize(tipSizeInput: string | undefined): TipSize {
  if (!tipSizeInput || !(tipSizeInput in validTipSizes)) {
    throw new Error(`Invalid tip size. Please specify one of ${Object.keys(validTipSizes).join(", ")}.`);
  }

  return validTipSizes[tipSizeInput];
}

export function tipSizeToOpenGovTrack(tipRequest: TipRequest): { track: OpenGovTrack; value: BN } {
  const chainConfig = getChainConfig(tipRequest);
  const tipValue = chainConfig.namedTips[tipRequest.tip.size];
  const tipValueWithDecimals = new BN(tipValue).mul(new BN(10).pow(new BN(chainConfig.decimals)));
  if (tipValue < chainConfig.smallTipperMaximum) {
    return { track: "SmallTipper", value: tipValueWithDecimals };
  }
  if (tipValue < chainConfig.bigTipperMaximum) {
    return { track: "BigTipper", value: tipValueWithDecimals };
  }
  throw new Error(
    `The requested tip value of '${tipValue}' exceeds the BigTipper track maximum of '${chainConfig.bigTipperMaximum}'.`,
  );
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
