import { randomAddress } from "./testUtil";
import { parseContributorAccount } from "./util";

describe("Utility functions", () => {
  describe("parseContributorAccount", () => {
    test("Can parse the account", () => {
      const address = randomAddress();
      const result = parseContributorAccount([`kusama address: ${address}`]);
      if ("error" in result) {
        throw new Error(result.error);
      }
      expect(result.network).toEqual("kusama");
      expect(result.address).toEqual(address);
    });

    test("allows uppercase", () => {
      const address = randomAddress();
      const result = parseContributorAccount([`Kusama Address: ${address}`]);
      if ("error" in result) {
        throw new Error(result.error);
      }
      expect(result.network).toEqual("kusama");
      expect(result.address).toEqual(address);
    });

    test("allows whitespace", () => {
      const address = randomAddress();
      const result = parseContributorAccount([`\nkusama Address: ${address}\n\n`]);
      if ("error" in result) {
        throw new Error(result.error);
      }
      expect(result.network).toEqual("kusama");
      expect(result.address).toEqual(address);
    });

    // Some people naturally put backticks aronud the address.
    test("allows backticks around the address", () => {
      const address = randomAddress();
      const result = parseContributorAccount([`Kusama Address: \`${address}\``]);
      if ("error" in result) {
        throw new Error(result.error);
      }
      expect(result.network).toEqual("kusama");
      expect(result.address).toEqual(address);
    });

    test("Returns error message when cannot parse", () => {
      const address = randomAddress();
      const result = parseContributorAccount([`kusama: ${address}`]);
      if (!("error" in result)) {
        throw new Error("Expected error message not found.");
      }
      expect(result.error).toMatch("hey 👋, you were nominated to receive a tip for your");
    });

    test("Throws on invalid network", () => {
      const address = randomAddress();
      const result = parseContributorAccount([`kussama address: ${address}`]);
      if (!("error" in result)) {
        throw new Error("Expected error message not found.");
      }
      expect(result.error).toMatch("Invalid network");
    });

    test("First body takes precedence over following bodies", () => {
      const addressA = randomAddress();
      const addressB = randomAddress();
      const result = parseContributorAccount([`kusama address: ${addressA}`, `polkadot address: ${addressB}`]);
      if ("error" in result) {
        throw new Error(result.error);
      }
      expect(result.network).toEqual("kusama");
      expect(result.address).toEqual(addressA);
    });

    test("Takes second body if the first one cannot be parsed", () => {
      const addressA = randomAddress();
      const addressB = randomAddress();

      {
        const result = parseContributorAccount([`kusama: ${addressA}`, `polkadot address: ${addressB}`]);
        if ("error" in result) {
          throw new Error(result.error);
        }
        expect(result.network).toEqual("polkadot");
        expect(result.address).toEqual(addressB);
      }

      {
        const result = parseContributorAccount([null, `polkadot address: ${addressB}`]);
        if ("error" in result) {
          throw new Error(result.error);
        }
        expect(result.network).toEqual("polkadot");
        expect(result.address).toEqual(addressB);
      }
    });

    test("Throws when the first body has invalid network", () => {
      const addressA = randomAddress();
      const addressB = randomAddress();
      const result = parseContributorAccount([`kussama address: ${addressA}`, `polkadot address: ${addressB}`]);
      if (!("error" in result)) {
        throw new Error("Expected error message not found.");
      }
      expect(result.error).toMatch("Invalid network");
    });
  });
});
