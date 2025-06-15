import { kusama, polkadot, rococo, westend } from "@polkadot-api/descriptors";
import { readFileSync } from "fs";

import { ChainConfig, TipNetwork } from "./types";

const papiConfig = JSON.parse(readFileSync(".papi/polkadot-api.json", "utf-8")) as {
  entries: {
    [p in TipNetwork]: {
      wsUrl: string;
      chain: string;
      metadata: string;
    };
  };
};

export function getWsUrl(network: TipNetwork): string {
  const local = Boolean(process.env.LOCAL_NETWORKS);

  switch (network) {
    case "kusama": {
      return local ? "ws://127.0.0.1:9901" : papiConfig.entries.kusama.wsUrl;
    }
    case "polkadot": {
      return local ? "ws://127.0.0.1:9900" : papiConfig.entries.polkadot.wsUrl;
    }
    case "rococo": {
      if (process.env.INTEGRATION_TEST) {
        return "ws://localrococo:9945"; // neighbouring container name
      }
      return local ? "ws://127.0.0.1:9902" : papiConfig.entries.rococo.wsUrl;
    }
    case "westend": {
      if (process.env.INTEGRATION_TEST) {
        return "ws://localwestend:9945"; // neighbouring container name
      }
      return local ? "ws://127.0.0.1:9903" : papiConfig.entries.westend.wsUrl;
    }
    default: {
      const exhaustivenessCheck: never = network;
      throw new Error(
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `Network is not handled properly in tipUser: ${exhaustivenessCheck}`,
      );
    }
  }
}

export type ChainDescriptor<Chain extends TipNetwork> = Chain extends "polkadot"
  ? typeof polkadot
  : Chain extends "kusama"
    ? typeof kusama
    : Chain extends "rococo"
      ? typeof rococo
      : Chain extends "westend"
        ? typeof westend
        : never;

export function getDescriptor<Chain extends TipNetwork>(network: Chain): ChainDescriptor<Chain> {
  const networks: { [Key in TipNetwork]: ChainDescriptor<Key> } = {
    polkadot,
    kusama,
    rococo,
    westend,
  };

  return networks[network] as ChainDescriptor<Chain>;
}

type Constants = Omit<ChainConfig, "providerEndpoint">;
export const kusamaConstants: Constants = {
  decimals: 12n,
  currencySymbol: "KSM",

  /**
   * Source of the calculation:
   * https://github.com/polkadot-fellows/runtimes/blob/30804db6b266ea79ad496a58208106038562e8fe/relay/kusama/src/governance/origins.rs#L185
   * https://github.com/polkadot-fellows/runtimes/blob/30804db6b266ea79ad496a58208106038562e8fe/relay/kusama/constants/src/lib.rs#L31
   */
  smallTipperMaximum: 8.33,

  /**
   * Source of the calculation:
   * https://github.com/polkadot-fellows/runtimes/blob/30804db6b266ea79ad496a58208106038562e8fe/relay/kusama/src/governance/origins.rs#L186
   * https://github.com/polkadot-fellows/runtimes/blob/30804db6b266ea79ad496a58208106038562e8fe/relay/kusama/constants/src/lib.rs#L33
   */
  bigTipperMaximum: 33.33,

  /**
   * These are arbitrary values, can be changed at any time.
   */
  namedTips: { small: 4n, medium: 16n, large: 30n },
};

export const polkadotConstants: Constants = {
  decimals: 10n,
  currencySymbol: "DOT",

  /**
   * Source of the calculation:
   * https://github.com/polkadot-fellows/runtimes/blob/30804db6b266ea79ad496a58208106038562e8fe/relay/polkadot/src/governance/origins.rs#L156
   * https://github.com/polkadot-fellows/runtimes/blob/30804db6b266ea79ad496a58208106038562e8fe/relay/polkadot/constants/src/lib.rs#L33
   */
  smallTipperMaximum: 250,

  /**
   * Source of the calculation:
   * https://github.com/polkadot-fellows/runtimes/blob/30804db6b266ea79ad496a58208106038562e8fe/relay/polkadot/src/governance/origins.rs#L157
   * https://github.com/polkadot-fellows/runtimes/blob/30804db6b266ea79ad496a58208106038562e8fe/relay/polkadot/constants/src/lib.rs#L34
   */
  bigTipperMaximum: 1000,

  /**
   * These are arbitrary values, can be changed at any time.
   */
  namedTips: { small: 20n, medium: 80n, large: 150n },
};

export const rococoConstants: Constants = {
  decimals: 12n,
  currencySymbol: "ROC",

  /**
   * Source of the calculation:
   * https://github.com/paritytech/polkadot-sdk/blob/d7862aa8c9b4f8be1d4330bc11c742bf48d407f6/polkadot/runtime/rococo/src/governance/origins.rs#L172
   * https://github.com/paritytech/polkadot-sdk/blob/d7862aa8c9b4f8be1d4330bc11c742bf48d407f6/polkadot/runtime/rococo/constants/src/lib.rs#L29
   */
  smallTipperMaximum: 0.025,

  /**
   * Source of the calculation:
   * https://github.com/paritytech/polkadot-sdk/blob/d7862aa8c9b4f8be1d4330bc11c742bf48d407f6/polkadot/runtime/rococo/src/governance/origins.rs#L173
   * https://github.com/paritytech/polkadot-sdk/blob/d7862aa8c9b4f8be1d4330bc11c742bf48d407f6/polkadot/runtime/rococo/constants/src/lib.rs#L30
   */
  bigTipperMaximum: 3.333,

  /**
   * These are arbitrary values, can be changed at any time.
   */
  namedTips: { small: 1n, medium: 2n, large: 3n },
};

export const westendConstants: Constants = {
  decimals: 12n,
  currencySymbol: "WND",

  /**
   * Source of the calculation:
   * https://github.com/paritytech/polkadot-sdk/blob/d7862aa8c9b4f8be1d4330bc11c742bf48d407f6/polkadot/runtime/westend/src/governance/origins.rs#L172
   * https://github.com/paritytech/polkadot-sdk/blob/d7862aa8c9b4f8be1d4330bc11c742bf48d407f6/polkadot/runtime/westend/constants/src/lib.rs#L29
   */
  smallTipperMaximum: 0.025,

  /**
   * Source of the calculation:
   * https://github.com/paritytech/polkadot-sdk/blob/d7862aa8c9b4f8be1d4330bc11c742bf48d407f6/polkadot/runtime/westend/src/governance/origins.rs#L173
   * https://github.com/paritytech/polkadot-sdk/blob/d7862aa8c9b4f8be1d4330bc11c742bf48d407f6/polkadot/runtime/westend/constants/src/lib.rs#L30
   */
  bigTipperMaximum: 3.333,

  /**
   * These are arbitrary values, can be changed at any time.
   */
  namedTips: { small: 1n, medium: 2n, large: 3n },
};

export function getChainConfig(network: TipNetwork): ChainConfig {
  switch (network) {
    case "kusama": {
      return kusamaConstants;
    }
    case "polkadot": {
      return polkadotConstants;
    }
    case "rococo": {
      return rococoConstants;
    }
    case "westend": {
      return westendConstants;
    }
    default: {
      const exhaustivenessCheck: never = network;
      throw new Error(
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `Network is not handled properly in tipUser: ${exhaustivenessCheck}`,
      );
    }
  }
}
