import crypto from "node:crypto";

/** Public key (SPKI DER, base64) — keep in sync with public/manifest.json "key". */
export const MANIFEST_PUBLIC_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvZP8mcI3IsxvlzSBkc7yfA1ksA30JG4QLzLTQlYA2BEfmNrwFJLF/kOYSH6LrNKh27k2HYI4tzDHVXL4RWo93HVBNxoI1kPBRcPps1wRxyFU+RurzlT/NFtZ5wPxs7oeA78/bwB/kXHAn4RtgzQ/gBYPfELwXn5N7MRVR/iKugOCpm9pdWz5NiBmVJxSe2k1TXir7yH0Y6bRLEUtOftnrM0Oz2+N8962x2Z+Qeu+UwT+ht2hJ1X5Nd1CmrQVEIBfWhyqa1mbwAZI3gf3P01hFRJ0442AYrDtX8WnqSmv5vSyAXRa/Oh20x7E37G4PAyEq7zmefc0EZT6WdIBdNyeswIDAQAB";

/** Fixed extension ID for all installs (local build + GitHub Release zip). */
export const FIXED_EXTENSION_ID = "bbmllidogccokoahnlmgehbikklpdcgd";

export function chromeExtensionIdFromManifestKey(publicKeyBase64: string): string {
  const der = Buffer.from(publicKeyBase64, "base64");
  const hash = crypto.createHash("sha256").update(der).digest();
  let hex = "";
  for (let i = 0; i < 16; i++) hex += hash[i]!.toString(16).padStart(2, "0");
  return hex
    .split("")
    .map((ch) => String.fromCharCode("a".charCodeAt(0) + Number.parseInt(ch, 16)))
    .join("");
}
