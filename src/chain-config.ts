import { ChainConfig, TipNetwork } from "./types";

type Constants = Omit<ChainConfig, "providerEndpoint">;
const kusamaConstants: Constants = {
  decimals: 12,
  currencySymbol: "KSM",

  /**
   * Source of the calculation:
   * https://github.com/paritytech/polkadot/blob/e164da65873f11bf8c583e81f6d82c21b005cfe4/runtime/kusama/src/governance/origins.rs#L172
   * https://github.com/paritytech/polkadot/blob/e164da65873f11bf8c583e81f6d82c21b005cfe4/runtime/kusama/constants/src/lib.rs#L29
   */
  smallTipperMaximum: 8.33,

  /**
   * Source of the calculation:
   * https://github.com/paritytech/polkadot/blob/e164da65873f11bf8c583e81f6d82c21b005cfe4/runtime/kusama/src/governance/origins.rs#L173
   * https://github.com/paritytech/polkadot/blob/e164da65873f11bf8c583e81f6d82c21b005cfe4/runtime/kusama/constants/src/lib.rs#L31
   */
  bigTipperMaximum: 33.33,

  /**
   * These are arbitrary values, can be changed at any time.
   */
  namedTips: { small: 2, medium: 5, large: 8 },
};

const polkadotConstants: Constants = {
  decimals: 10,
  currencySymbol: "DOT",

  /**
   * Source of the calculation:
   * https://github.com/paritytech/polkadot/blob/e164da65873f11bf8c583e81f6d82c21b005cfe4/runtime/polkadot/src/governance/origins.rs#L143
   * https://github.com/paritytech/polkadot/blob/e164da65873f11bf8c583e81f6d82c21b005cfe4/runtime/polkadot/constants/src/lib.rs#L31
   */
  smallTipperMaximum: 250,

  /**
   * Source of the calculation:
   * https://github.com/paritytech/polkadot/blob/e164da65873f11bf8c583e81f6d82c21b005cfe4/runtime/polkadot/src/governance/origins.rs#L144
   * https://github.com/paritytech/polkadot/blob/e164da65873f11bf8c583e81f6d82c21b005cfe4/runtime/polkadot/constants/src/lib.rs#L32
   */
  bigTipperMaximum: 1000,

  /**
   * These are arbitrary values, can be changed at any time.
   */
  namedTips: { small: 20, medium: 80, large: 150 },
};

export function getChainConfig(network: TipNetwork): ChainConfig {
  switch (network) {
    case "localkusama": {
      const providerEndpoint = "ws://127.0.0.1:9901";
      return { providerEndpoint, ...kusamaConstants };
    }
    case "localpolkadot": {
      const providerEndpoint = "ws://127.0.0.1:9900";
      return { providerEndpoint, ...polkadotConstants };
    }
    case "polkadot": {
      const providerEndpoint = "wss://rpc.polkadot.io";
      return { providerEndpoint, ...polkadotConstants };
    }
    case "kusama": {
      const providerEndpoint = `wss://${network}-rpc.polkadot.io`;
      return { providerEndpoint, ...kusamaConstants };
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

export function getTipUrl(network: TipNetwork): string {
  const config = getChainConfig(network);
  return `https://polkadot.js.org/apps/?rpc=${encodeURIComponent(config.providerEndpoint)}#/referenda`;
}
