import { createTestKeyring } from "@polkadot/keyring";
import { randomAsU8a } from "@polkadot/util-crypto";
import { Probot } from "probot";

export const randomAddress = (): string => createTestKeyring().addFromSeed(randomAsU8a(32)).address;

// eslint-disable-next-line @typescript-eslint/no-explicit-any,@typescript-eslint/no-unsafe-assignment
export const logMock: Probot["log"] = console.log.bind(console) as any;
logMock.error = console.error.bind(console);
logMock.info = console.log.bind(console);
