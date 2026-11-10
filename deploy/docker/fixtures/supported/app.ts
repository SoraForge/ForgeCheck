// The scanner reviews this file as source; nothing in it is executed.
import { StrKey } from "@stellar/stellar-sdk";
export function validateCreateAccountAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address);
}
