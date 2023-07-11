import "@polkadot/api-augment";

import { randomAddress } from "./testUtil";
import { parseContributorAccount } from "./util";

describe("Utility functions", () => {
  describe("parseContributorAccount", () => {
    test("Can parse the account", () => {
      const address = randomAddress();
      const result = parseContributorAccount([`kusama address: ${address}`]);
      expect(result.network).toEqual("kusama");
      expect(result.address).toEqual(address);
    });

    test("Throws when cannot parse", () => {
      const address = randomAddress();
      expect(() => parseContributorAccount([`kusama: ${address}`])).toThrowError(
        "Contributor did not properly post their account address",
      );
    });

    test("Throws on invalid network", () => {
      const address = randomAddress();
      expect(() => parseContributorAccount([`kussama address: ${address}`])).toThrowError("Invalid network");
    });

    test("First body takes precedence over following bodies", () => {
      const addressA = randomAddress();
      const addressB = randomAddress();
      const result = parseContributorAccount([`kusama address: ${addressA}`, `polkadot address: ${addressB}`]);
      expect(result.network).toEqual("kusama");
      expect(result.address).toEqual(addressA);
    });

    test("Takes second body if the first one cannot be parsed", () => {
      const addressA = randomAddress();
      const addressB = randomAddress();

      {
        const result = parseContributorAccount([`kusama: ${addressA}`, `polkadot address: ${addressB}`]);
        expect(result.network).toEqual("polkadot");
        expect(result.address).toEqual(addressB);
      }

      {
        const result = parseContributorAccount([null, `polkadot address: ${addressB}`]);
        expect(result.network).toEqual("polkadot");
        expect(result.address).toEqual(addressB);
      }
    });

    test("Throws when the first body has invalid network", () => {
      const addressA = randomAddress();
      const addressB = randomAddress();
      expect(() =>
        parseContributorAccount([`kussama address: ${addressA}`, `polkadot address: ${addressB}`]),
      ).toThrowError("Invalid network");
    });
  });
});
