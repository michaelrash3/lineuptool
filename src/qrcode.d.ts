// Minimal ambient types for the `qrcode` package (ships no types, and we only
// use toDataURL). Keeps QRCodeImg fully typed without pulling in @types/qrcode.
declare module "qrcode" {
  export interface QRCodeToDataURLOptions {
    width?: number;
    margin?: number;
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    color?: { dark?: string; light?: string };
  }
  export function toDataURL(
    text: string,
    options?: QRCodeToDataURLOptions,
  ): Promise<string>;
  const _default: { toDataURL: typeof toDataURL };
  export default _default;
}
