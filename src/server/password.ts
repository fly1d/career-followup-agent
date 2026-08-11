import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const SCRYPT_PARAMETERS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const DUMMY_PASSWORD_HASH =
  "scrypt$16384$8$1$Y2FyZWVyLWZvbGxvd3VwLWR1bW15LXNhbHQ$4yKLqlL9IyLR+M1RytAZ4qLGXt8iwZKbVYT6bfspHA/Jxvc24fxW+FN7SdPSZvzlYQ/bTSY7u6YCRclZtx9tzA==";

function deriveKey(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_LENGTH,
      SCRYPT_PARAMETERS,
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(24);
  const derivedKey = await deriveKey(password, salt);
  return [
    "scrypt",
    SCRYPT_PARAMETERS.N,
    SCRYPT_PARAMETERS.r,
    SCRYPT_PARAMETERS.p,
    salt.toString("base64"),
    derivedKey.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password: string, encodedHash: string) {
  const parts = encodedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, encodedSalt, encodedKey] = parts;
  const salt = Buffer.from(encodedSalt, "base64");
  const expectedKey = Buffer.from(encodedKey, "base64");
  if (
    Number(n) !== SCRYPT_PARAMETERS.N ||
    Number(r) !== SCRYPT_PARAMETERS.r ||
    Number(p) !== SCRYPT_PARAMETERS.p ||
    expectedKey.length !== KEY_LENGTH
  ) {
    return false;
  }

  const actualKey = await deriveKey(password, salt);
  return timingSafeEqual(actualKey, expectedKey);
}

export async function consumeLoginTiming(password: string) {
  await verifyPassword(password, DUMMY_PASSWORD_HASH);
}
