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

export function getTipSize(tipSizeInput: string | undefined): TipSize | BN {
  if (tipSizeInput === undefined || tipSizeInput.length === 0) {
    throw new Error("Tip size not specified");
  }

  try {
    // See if the input specifies an explicit numeric tip value.
    return new BN(tipSizeInput);
  } catch {}

  if (!tipSizeInput || !(tipSizeInput in validTipSizes)) {
    throw new Error(`Invalid tip size. Please specify one of ${Object.keys(validTipSizes).join(", ")}.`);
  }

  return validTipSizes[tipSizeInput];
}

export function tipSizeToOpenGovTrack(tipRequest: TipRequest): { track: OpenGovTrack; value: BN } | { error: string } {
  const chainConfig = getChainConfig(tipRequest.contributor.account.network);
  const decimalPower = new BN(10).pow(new BN(chainConfig.decimals));
  const tipSize = tipRequest.tip.size;
  const tipValue = BN.isBN(tipSize) ? tipSize : new BN(chainConfig.namedTips[tipSize]);
  const tipValueWithDecimals = tipValue.mul(decimalPower);
  if (tipValue.ltn(chainConfig.smallTipperMaximum)) {
    return { track: "SmallTipper", value: tipValueWithDecimals };
  }
  if (tipValue.ltn(chainConfig.bigTipperMaximum)) {
    return { track: "BigTipper", value: tipValueWithDecimals };
  }
  return {
    error: `The requested tip value of '${formatTipSize(tipRequest)}' exceeds the BigTipper track maximum of '${
      chainConfig.bigTipperMaximum
    } ${chainConfig.currencySymbol}'.`,
  };
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
  const { contributor, pullRequestNumber, pullRequestRepo } = tipRequest;
  return `TO: ${contributor.githubUsername} FOR: ${pullRequestRepo}#${pullRequestNumber} (${formatTipSize(
    tipRequest,
  )})`;
};

/**
 * @returns For example "medium", "medium (5 KSM)", or "13 KSM".
 */
export const formatTipSize = (tipRequest: TipRequest): string => {
  const tipSize = tipRequest.tip.size;
  const chainConfig = getChainConfig(tipRequest.contributor.account.network);
  if (BN.isBN(tipSize)) {
    // e.g. "13 KSM"
    return `${tipSize.toString()} ${chainConfig.currencySymbol}`;
  }
  if (chainConfig.tipType === "opengov") {
    const value = chainConfig.namedTips[tipSize];
    // e.g. "medium (5 KSM)
    return `${tipSize} (${value.toString()} ${chainConfig.currencySymbol})`;
  }
  // e.g. "medium"
  return tipSize;
};
