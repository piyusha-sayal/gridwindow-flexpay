/**
 * Provider-mode isolation. A reservation records the provider that created it (reservations.provider_mode). Its
 * order, authorization and capture ids exist only at that provider, so a process running a different gateway must
 * never look them up, void them, capture them or replay requests for them.
 */
import type { ProviderMode } from "@/payments/gateway";
import { ServiceError, type AppDeps } from "./deps";
import type { ReservationRow } from "./repo";

export function inProviderScope(deps: Pick<AppDeps, "gateway">, r: Pick<ReservationRow, "provider_mode">): boolean {
  return r.provider_mode === deps.gateway.mode;
}

/** Fails closed before any gateway call or write for a reservation that belongs to the other provider. */
export function assertProviderScope(deps: Pick<AppDeps, "gateway">, r: Pick<ReservationRow, "provider_mode">): void {
  if (!inProviderScope(deps, r)) {
    throw new ServiceError("PROVIDER_MODE_MISMATCH", `This reservation belongs to the ${r.provider_mode as ProviderMode} provider; the running provider is ${deps.gateway.mode}.`, 409);
  }
}
