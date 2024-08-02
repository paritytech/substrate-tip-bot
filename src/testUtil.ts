import crypto from "crypto";
import { AccountId } from "polkadot-api";
import { Probot } from "probot";

export function randomAddress(): string {
  return AccountId().dec(crypto.randomBytes(32));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any,@typescript-eslint/no-unsafe-assignment
export const logMock: Probot["log"] = console.log.bind(console) as any;
logMock.error = console.error.bind(console);
logMock.info = console.log.bind(console);
