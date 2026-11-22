export interface GardenCipher { version: 1; keyId: string; wrappedKey: string; iv: string; ciphertext: string }
/** Portable key record. Only the passphrase-wrapped PKCS8 private key is persisted. */
export interface GardenKeyEnvelope {
  id?: number;
  keyId: string;
  version: 1;
  publicKey: string;
  salt: string;
  iterations: number;
  iv: string;
  privateKey: string;
  updatedAt: number;
}
