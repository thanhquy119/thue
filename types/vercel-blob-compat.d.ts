import "@vercel/blob";

declare module "@vercel/blob" {
  export function put(
    pathname: string,
    body: string | Buffer | Uint8Array,
    options?: Record<string, unknown>,
  ): Promise<PutBlobResult>;
}
