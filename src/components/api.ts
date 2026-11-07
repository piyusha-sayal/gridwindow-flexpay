/** Typed browser fetch helper; surfaces server error messages and never throws raw responses. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError("NETWORK", "Network error. Check your connection and try again.", 0);
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: { code: string; message: string } }) | null;
  if (!res.ok || !body) throw new ApiError(body?.error?.code ?? "HTTP_ERROR", body?.error?.message ?? `Request failed (${res.status}).`, res.status);
  return body;
}

export const ERROR_COPY: Record<string, string> = {
  QUOTE_EXPIRED: "That offer expired. Request fresh offers — prices and capacity can change.",
  CAPACITY_CHANGED: "Station capacity changed since the offer was made. Request fresh offers.",
  CHECKOUT_STATE_INVALID: "We couldn't verify that checkout session. No authorization was made from this request.",
  PROVIDER_MISMATCH: "The payment provider returned details that don't match your accepted terms. Nothing was authorized.",
  APPROVAL_TOO_LATE: "Your approval arrived after the scheduled charging was due to start, so this offer can no longer be honored. No payment was taken and nothing is on hold. Request fresh offers.",
  INTERNAL: "Something went wrong. No payment action was taken by this request.",
};
