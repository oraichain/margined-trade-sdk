import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { stringToPath } from "@cosmjs/crypto";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { GasPrice } from "@cosmjs/stargate";
import crypto from "crypto";

export type UserWallet = { address: string; client: SigningCosmWasmClient };
const truncDecimals = 6;
export const atomic = 10 ** truncDecimals;

export async function sendToken(
  client: SigningCosmWasmClient,
  senderAddress: string,
  recipientAddress: string,
  amount: string
) {
  const fee = {
    gas: "30000000",
    amount: [{ denom: "orai", amount: "150000" }],
  };

  return await client.sendTokens(
    senderAddress,
    recipientAddress,
    [{ denom: "orai", amount: amount }],
    fee
  );
}

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

export const getOraclePrice = async (token: string): Promise<number> => {
  const res = await fetch(
    `https://api.orchai.io/lending/mainnet/token/${token}`
  ).then((res) => res.json());
  return res.current_price;
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

export async function setupWallet(
  mnemonic: string,
  prefix?: string
): Promise<UserWallet> {
  if (!mnemonic || mnemonic.length < 48) {
    throw new Error("Must set MNEMONIC to a 12 word phrase");
  }
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    hdPaths: [stringToPath(process.env.HD_PATH || "m/44'/118'/0'/0/0")],
    prefix: prefix ?? "orai",
  });
  const [firstAccount] = await wallet.getAccounts();
  const address = firstAccount.address;
  const client = await SigningCosmWasmClient.connectWithSigner(
    process.env.RPC_URL!,
    wallet,
    {
      gasPrice: GasPrice.fromString("0.002orai"),
    }
  );

  return { address, client };
}