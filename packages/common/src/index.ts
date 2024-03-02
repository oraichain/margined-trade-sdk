import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { stringToPath } from "@cosmjs/crypto";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { GasPrice } from "@cosmjs/stargate";
import crypto from "crypto";

export type UserWallet = { address: string; client: SigningCosmWasmClient };
const truncDecimals = 6;
export const atomic = 10 ** truncDecimals;

export type RetryOptions = {
  retry?: number;
  timeout?: number;
  callback?: (retry: number) => void;
};

const fetchRetry = async (
  url: RequestInfo | URL,
  opts: RequestInit & RetryOptions = {}
) => {
  let { retry = 3, callback, timeout = 30000, ...init } = opts;
  init.signal = AbortSignal.timeout(timeout);
  while (retry > 0) {
    try {
      return await fetch(url, init);
    } catch (e) {
      callback?.(retry);
      retry--;
      if (retry === 0) {
        throw e;
      }
    }
  }
};

export const delay = (milliseconds: number) => {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
};

export const encrypt = (password: string, val: string) => {
  const hashedPassword = crypto.createHash("sha256").update(password).digest();
  const IV = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", hashedPassword, IV);
  return Buffer.concat([IV, cipher.update(val), cipher.final()]).toString(
    "base64"
  );
};

export const decrypt = (password: string, val: string) => {
  const hashedPassword = crypto.createHash("sha256").update(password).digest();
  const encryptedText = Buffer.from(val, "base64");
  const IV = encryptedText.subarray(0, 16);
  const encrypted = encryptedText.subarray(16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", hashedPassword, IV);
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString();
};

export const getRandomRange = (min: number, max: number): number => {
  return ((Math.random() * (max - min + 1)) << 0) + min;
};

export const getOraclePrice = async (
  token: string,
  url?: string
): Promise<number> => {
  const response = await fetchRetry(
    url ?? `https://api.orchai.io/lending/mainnet/token/${token}`
  );
  const result = await response.json();
  return result.current_price;
};

export const getCoingeckoPrice = async (
  token: "oraichain-token" | "airight",
  url?: string
): Promise<number> => {
  const response = await fetchRetry(
    url ??
      `https://price.market.orai.io/simple/price?ids=${token}&vs_currencies=usd`
  );
  const result = await response.json();
  return result[token].usd;
};

export const getPriceFeed = async (
  token: string,
  url?: string
): Promise<number> => {
  console.log("getPriceFeed url", url);
  const response = await fetchRetry(url);
  const priceData = await response.json();
  console.log({ priceData });

  if (priceData.token.toLowerCase() === token.toLowerCase()) {
    return Number(priceData.price.toFixed(6));
  }
  return 0;
};

export const validateNumber = (amount: number | string): number => {
  if (typeof amount === "string") return validateNumber(Number(amount));
  if (Number.isNaN(amount) || !Number.isFinite(amount)) return 0;
  return amount;
};

export const toDecimals = (num: number, decimals: number = 9): string => {
  return (num * 10 ** decimals).toFixed();
};

// decimals always >= 6
export const toAmount = (amount: number, decimals = 6): bigint => {
  const validatedAmount = validateNumber(amount);
  return (
    BigInt(Math.trunc(validatedAmount * atomic)) *
    BigInt(10 ** (decimals - truncDecimals))
  );
};

// bigint abs
export const bigAbs = (n: bigint) => (n < 0 ? -n : n);

export async function setupWallet(
  mnemonic: string,
  config: {
    hdPath?: string;
    rpcUrl?: string;
    gasPrices?: string;
    prefix?: string;
  },
  cosmwasmClient?: SigningCosmWasmClient
): Promise<UserWallet> {
  if (!mnemonic || mnemonic.length < 48) {
    throw new Error("Must set MNEMONIC to a 12 word phrase");
  }
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    hdPaths: [stringToPath(config.hdPath ?? "m/44'/118'/0'/0/0")],
    prefix: config.prefix ?? "orai",
  });
  const [firstAccount] = await wallet.getAccounts();
  const address = firstAccount.address;
  const client =
    cosmwasmClient ??
    (await SigningCosmWasmClient.connectWithSigner(
      config.rpcUrl || "https://rpc.orai.io",
      wallet,
      {
        gasPrice: GasPrice.fromString(`${config.gasPrices ?? "0.001"}orai`),
      }
    ));

  return { address, client };
}

export function getDifferencePercentage(a: number, b: number) {
  return Math.abs((100 * (a - b)) / b);
}

export const toDisplay = (
  amount: string | bigint,
  sourceDecimals = 6,
  desDecimals = 6
): number => {
  if (!amount) return 0;
  if (typeof amount === "string" && amount.indexOf(".") !== -1)
    amount = amount.split(".")[0];
  try {
    // guarding conditions to prevent crashing
    const validatedAmount =
      typeof amount === "string" ? BigInt(amount || "0") : amount;
    const displayDecimals = Math.min(truncDecimals, desDecimals);
    const returnAmount =
      validatedAmount / BigInt(10 ** (sourceDecimals - displayDecimals));
    // save calculation by using cached atomic
    return (
      Number(returnAmount) /
      (displayDecimals === truncDecimals ? atomic : 10 ** displayDecimals)
    );
  } catch {
    return 0;
  }
};
