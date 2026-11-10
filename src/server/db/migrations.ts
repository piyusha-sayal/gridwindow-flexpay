/** Ordered, append-only SQL migrations (PostgreSQL dialect; runs on PGlite or a real server). Never edit an applied entry: its checksum is recorded. */
export interface Migration {
  readonly id: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: "001_core",
    sql: `
create table quote_sets (
  id text primary key,
  driver_session text not null,
  station_id text not null,
  night_of text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  payload jsonb not null
);

create table reservations (
  id text primary key,
  quote_set_id text not null references quote_sets(id),
  offer_id text not null unique,
  driver_session text not null,
  station_id text not null,
  night_of text not null,
  port_id text not null,
  plug_in_at timestamptz not null,
  depart_at timestamptz not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency = 'USD'),
  terms_hash text not null,
  terms jsonb not null,
  payment_state text not null,
  service_state text not null,
  slots_committed boolean not null default false,
  provider_mode text not null,
  approve_url text,
  checkout_state_hash text not null,
  paypal_order_id text unique,
  paypal_authorization_id text unique,
  paypal_capture_id text unique,
  authorization_expires_at timestamptz,
  authorized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reservations_station_night on reservations (station_id, night_of);

create table payment_operations (
  id bigserial primary key,
  reservation_id text not null references reservations(id),
  kind text not null check (kind in ('CREATE_ORDER','AUTHORIZE','CAPTURE','VOID')),
  idempotency_key text not null unique,
  status text not null check (status in ('STARTED','SUCCEEDED','FAILED','AMBIGUOUS')),
  provider_ref text,
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
-- Capture and void are mutually exclusive per reservation: at most one settlement operation.
create unique index payment_operations_one_settlement on payment_operations (reservation_id) where kind in ('CAPTURE','VOID');

create table provider_proofs (
  reservation_id text not null references reservations(id),
  proof_type text not null check (proof_type in ('ORDER_CREATED','BUYER_APPROVED','AUTHORIZED','CAPTURED','VOIDED')),
  provider_mode text not null,
  provider_ref text not null,
  provider_status text not null,
  amount_cents integer,
  evidence_source text not null check (evidence_source in ('PAYPAL_SANDBOX_API','MOCK_PROVIDER')),
  observed_at timestamptz not null default now(),
  primary key (reservation_id, proof_type)
);

create table webhook_inbox (
  event_id text primary key,
  event_type text not null,
  resource_id text,
  reservation_id text,
  raw_sha256 text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table simulation_runs (
  id text primary key,
  reservation_id text not null unique references reservations(id),
  outcome text not null check (outcome in ('DELIVERED','FAILED')),
  delivered_battery_mwh integer not null,
  target_battery_mwh integer not null,
  faults jsonb not null,
  triggered_by text not null,
  created_at timestamptz not null default now()
);

create table energy_records (
  run_id text not null references simulation_runs(id),
  reservation_id text not null references reservations(id),
  slot_index integer not null,
  slot_start timestamptz not null,
  commanded_w integer not null,
  delivered_w integer not null,
  grid_wh integer not null,
  battery_mwh integer not null,
  limited_by text not null,
  source text not null check (source = 'SYNTHETIC'),
  primary key (run_id, slot_index)
);

create table events (
  id bigserial primary key,
  reservation_id text,
  type text not null,
  source text not null check (source in ('APP','DRIVER','OPERATOR','SYNTHETIC_SIMULATOR','PAYPAL_SANDBOX_API','PAYPAL_WEBHOOK','MOCK_PROVIDER','RECONCILER')),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index events_reservation on events (reservation_id, id);

create function gw_forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'table % is append-only', tg_table_name;
end
$$;
create trigger events_append_only before update or delete on events for each row execute function gw_forbid_mutation();
create trigger energy_records_append_only before update or delete on energy_records for each row execute function gw_forbid_mutation();

create table mock_provider_objects (
  id text primary key,
  kind text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
`,
  },
  {
    id: "002_operation_recovery",
    sql: `
-- Lease: only one worker may have a provider call in flight per operation.
-- request: exact provider input, persisted before the call, so a replay is byte-identical.
-- terms_hash/amount_cents: binds the operation to the immutable accepted offer.
alter table payment_operations add column lease_until timestamptz;
alter table payment_operations add column attempts integer not null default 0;
alter table payment_operations add column request jsonb;
alter table payment_operations add column terms_hash text;
alter table payment_operations add column amount_cents integer;

create function gw_forbid_terms_change() returns trigger language plpgsql as $$
begin
  if new.offer_id is distinct from old.offer_id or new.terms is distinct from old.terms or new.terms_hash is distinct from old.terms_hash
     or new.amount_cents is distinct from old.amount_cents or new.currency is distinct from old.currency or new.driver_session is distinct from old.driver_session then
    raise exception 'accepted terms are immutable';
  end if;
  return new;
end
$$;
create trigger reservations_terms_immutable before update on reservations for each row execute function gw_forbid_terms_change();
`,
  },
  {
    id: "003_recovery_engine",
    sql: `
-- Recorded disturbances (append-only). event_id is the idempotency key supplied by the caller.
create table disruption_events (
  id text primary key,
  event_id text not null unique,
  reservation_id text not null references reservations(id),
  type text not null check (type in ('CHARGER_POWER_REDUCTION','SITE_CAP_REDUCTION','EARLY_DEPARTURE','CHARGER_FAILURE')),
  params jsonb not null,
  effective_slot integer not null check (effective_slot >= 0),
  provenance text not null default 'SYNTHETIC' check (provenance = 'SYNTHETIC'),
  created_by text not null,
  created_at timestamptz not null default now()
);
create index disruption_events_reservation on disruption_events (reservation_id);
create trigger disruption_events_append_only before update or delete on disruption_events for each row execute function gw_forbid_mutation();

-- One recovery attempt per disturbance. Status changes only by compare-and-set on the expected status.
create table recovery_runs (
  id text primary key,
  disruption_event_id text not null unique references disruption_events(event_id),
  status text not null check (status in ('RUNNING','COMMITTED','NEEDS_APPROVAL','INFEASIBLE','FAILED','APPROVED','REJECTED','EXPIRED')),
  trace jsonb not null default '[]'::jsonb,
  proposal jsonb,
  proposal_version integer,
  expires_at timestamptz,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Schedule versions (append-only). Version 1 is implicit: the agreed terms.powerW.
create table schedule_versions (
  reservation_id text not null references reservations(id),
  version integer not null check (version >= 2),
  source text not null check (source in ('RECOVERY','MANUAL')),
  power_w jsonb not null,
  reason text not null,
  recovery_run_id text references recovery_runs(id),
  created_at timestamptz not null default now(),
  primary key (reservation_id, version)
);
create trigger schedule_versions_append_only before update or delete on schedule_versions for each row execute function gw_forbid_mutation();
`,
  },
  {
    id: "004_recovery_orchestrator",
    sql: `
-- Orchestrator bookkeeping: bounded attempts, whether a model call was accepted, the decision record and the narrative.
alter table recovery_runs
  add column attempts integer not null default 0 check (attempts >= 0),
  add column ai_used boolean not null default false,
  add column outcome jsonb,
  add column explanation jsonb;
`,
  },
  {
    id: "005_sweep_checked_at",
    sql: `
-- Durable fairness marker for the reconciliation sweep: rows checked least recently are selected first.
alter table reservations add column sweep_checked_at timestamptz;
`,
  },
];
