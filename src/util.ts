import { ApiPromise } from "@polkadot/api";
import { SubmittableExtrinsic } from "@polkadot/api/promise/types";
import type { ApiDecoration } from "@polkadot/api/types";
import { BN } from "@polkadot/util";
import assert from "assert";

import { getChainConfig } from "./chain-config";
import {
  BigTipperTrack,
  ContributorAccount,
  OpenGovTrack,
  SmallTipperTrack,
  TipNetwork,
  TipRequest,
  TipResult,
  TipSize,
} from "./types";

const validTipSizes: { [key: string]: TipSize } = { small: "small", medium: "medium", large: "large" } as const;
const validNetworks: { [key: string]: TipNetwork } = {
  polkadot: "polkadot",
  kusama: "kusama",
  rococo: "rococo",
  westend: "westend",
  ...(process.env.NODE_TYPE === "development"
    ? {
        localpolkadot: "localpolkadot",
        localkusama: "localkusama",
        localrococo: "localrococo",
        localwestend: "localwestend",
      }
    : {}),
} as const;

export function getTipSize(tipSizeInput: string | undefined): TipSize | BN | { error: string } {
  if (tipSizeInput === undefined || tipSizeInput.length === 0) {
    return { error: "Tip size not specified" };
  }

  try {
    // See if the input specifies an explicit numeric tip value.
    return new BN(tipSizeInput);
  } catch {}

  if (!tipSizeInput || !(tipSizeInput in validTipSizes)) {
    return { error: `Invalid tip size. Please specify one of ${Object.keys(validTipSizes).join(", ")}.` };
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
    return { track: SmallTipperTrack, value: tipValueWithDecimals };
  }
  if (tipValue.ltn(chainConfig.bigTipperMaximum)) {
    return { track: BigTipperTrack, value: tipValueWithDecimals };
  }
  return {
    error: `The requested tip value of '${formatTipSize(tipRequest)}' exceeds the BigTipper track maximum of '${
      chainConfig.bigTipperMaximum
    } ${chainConfig.currencySymbol}'.`,
  };
}

export function parseContributorAccount(bodys: (string | null)[]): ContributorAccount | { error: string } {
  for (const body of bodys) {
    const matches =
      typeof body === "string" &&
      body.match(
        // match "polkadot address: <ADDRESS>"
        /(\S+)\s*address:\s*([a-z0-9]+)/i,
      );

    if (matches === false || matches === null || matches.length != 3) {
      continue;
    }

    const [matched, networkInput, address] = matches;
    assert(networkInput, `networkInput could not be parsed from "${matched}"`);
    assert(address, `address could not be parsed from "${matched}"`);

    const network =
      networkInput.toLowerCase() in validNetworks
        ? validNetworks[networkInput.toLowerCase() as keyof typeof validNetworks]
        : undefined;
    if (!network) {
      return {
        error: `Invalid network: "${networkInput}". Please select one of: ${Object.keys(validNetworks).join(", ")}.`,
      };
    }

    return { network, address };
  }

  return {
    error: `Contributor did not properly post their account address.\n\nMake sure the pull request description (or user bio) has: "{network} address: {address}".`,
  };
}

/**
 * Formats the tip request into a human-readable string.
 * For example: "TO: someone FOR: substrate#123 (13 KSM)"
 *
 * With markdown option enabled, it will produce a multi-line markdown text.
 */
export const formatReason = (tipRequest: TipRequest, opts: { markdown: boolean } = { markdown: false }): string => {
  const { contributor, pullRequestNumber, pullRequestRepo } = tipRequest;
  if (!opts.markdown) {
    return `TO: ${contributor.githubUsername} FOR: ${pullRequestRepo}#${pullRequestNumber} (${formatTipSize(
      tipRequest,
    )})`;
  }

  return `This is a tip created by the [tip-bot](https://github.com/paritytech/substrate-tip-bot/).

### Details

- **Repository:** [${pullRequestRepo}](https://github.com/paritytech/${pullRequestRepo})
- **PR:** [#${pullRequestNumber}](https://github.com/paritytech/${pullRequestRepo}/pull/${pullRequestNumber})
- **Contributor:** [${contributor.githubUsername}](https://github.com/${contributor.githubUsername})
- **Tip Size:** ${formatTipSize(tipRequest)}
`;
};

/**
 * @returns For example "medium (5 KSM)" or "13 KSM".
 */
export const formatTipSize = (tipRequest: TipRequest): string => {
  const tipSize = tipRequest.tip.size;
  const chainConfig = getChainConfig(tipRequest.contributor.account.network);
  if (BN.isBN(tipSize)) {
    // e.g. "13 KSM"
    return `${tipSize.toString()} ${chainConfig.currencySymbol}`;
  }
  const value = chainConfig.namedTips[tipSize];
  // e.g. "medium (5 KSM)
  return `${tipSize} (${value.toString()} ${chainConfig.currencySymbol})`;
};

/**
 * Matrix handles of the team supporting this project.
 * Currently - Engineering Automation / Opstooling.
 * It is used to tag these usernames when there is a failure.
 */
export const teamMatrixHandles =
  process.env.NODE_ENV === "development" ? [] : ["@przemek", "@mak", "@yuri", "@bullrich"]; // Don't interrupt other people when testing.

export const byteSize = (extrinsic: SubmittableExtrinsic): number =>
  extrinsic.method.toU8a().length * Uint8Array.BYTES_PER_ELEMENT;

export const encodeProposal = (
  api: ApiPromise,
  tipRequest: TipRequest,
): { encodedProposal: string; proposalByteSize: number } | TipResult => {
  const track = tipSizeToOpenGovTrack(tipRequest);
  if ("error" in track) {
    return { success: false, errorMessage: track.error };
  }
  const contributorAddress = tipRequest.contributor.account.address;

  const proposalTx = api.tx.treasury.spend(track.value.toString(), contributorAddress);
  const encodedProposal = proposalTx.method.toHex();
  const proposalByteSize = byteSize(proposalTx);
  if (proposalByteSize >= 128) {
    return {
      success: false,
      errorMessage: `The proposal length of ${proposalByteSize} equals or exceeds 128 bytes and cannot be inlined in the referendum.`,
    };
  }
  return { encodedProposal, proposalByteSize };
};

/**
 * @param apiAtBlock - The ApiPromise should be pointing at the block hash that is expected to contain the referendum.
 * @param encodedProposal - Encoded proposal of the referendum - aka inlined preimage.
 */
export const getReferendumId = async (
  apiAtBlock: ApiDecoration<"promise">,
  encodedProposal: string,
): Promise<undefined | number> => {
  // https://github.com/paritytech/substrate/blob/63246b699d7e2645c8b12aae46f8f0765c682183/frame/referenda/src/lib.rs#L271-L278
  // [index, track, proposal]
  type ReferendumSubmittedData = [number, number, Record<string, unknown>];

  const events = await apiAtBlock.query.system.events();
  const referendumEvent = events.find(
    (record) =>
      record.event.section === "referenda" &&
      record.event.method === "Submitted" &&
      (record.event.data.toJSON() as ReferendumSubmittedData)[2].inline === encodedProposal,
  );
  return (referendumEvent?.event.data.toJSON() as ReferendumSubmittedData)?.[0];
};
