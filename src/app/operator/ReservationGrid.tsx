"use client";

import { useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams, type RowClassRules } from "ag-grid-community";
import { ATTENTION_STATES, PaymentBadge, ServiceBadge } from "@/components/ui";
import type { DashboardSession, OperatorDashboard } from "@/server/services/viewService";
import { needsAttention } from "./metrics";

ModuleRegistry.registerModules([AllCommunityModule]);

/** AG Grid theme matched to the app's classical palette. */
const gridTheme = themeQuartz.withParams({
  fontFamily: "var(--font-sans)",
  fontSize: 14,
  accentColor: "#b68235",
  backgroundColor: "#faf9f8",
  foregroundColor: "#201f1d",
  headerBackgroundColor: "#f3f2f2",
  headerFontWeight: 600,
  borderColor: "#d7d3d3",
  rowHoverColor: "rgb(182 130 53 / 0.08)",
  selectedRowBackgroundColor: "rgb(182 130 53 / 0.16)",
  wrapperBorderRadius: 7,
});

type Row = {
  id: string;
  portId: string;
  plugIn: string;
  readyBy: string;
  energyKwh: number;
  amount: number;
  discount: number;
  operatorGain: number;
  paymentState: string;
  serviceState: string;
  provider: string;
  lastEvent: string;
  attention: boolean;
  slotsCommitted: boolean;
};

const money = (n: number) => `$${n.toFixed(2)}`;

export function ReservationGrid({ d, selectedId, onSelect }: { d: OperatorDashboard; selectedId: string | null; onSelect: (id: string) => void }) {
  const grid = useRef<AgGridReact<Row>>(null);
  const [quick, setQuick] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);

  const rows = useMemo<Row[]>(() => {
    const t = new Intl.DateTimeFormat("en-US", { timeZone: d.timeZone, hour: "2-digit", minute: "2-digit", hour12: false });
    return d.sessions.map((s: DashboardSession) => ({
      id: s.id,
      portId: s.portId,
      plugIn: t.format(s.plugInMs),
      readyBy: t.format(s.departMs),
      energyKwh: Math.round(s.targetBatteryWh / 100) / 10,
      amount: s.amountCents / 100,
      discount: s.discountCents / 100,
      operatorGain: s.operatorImprovementCents / 100,
      paymentState: s.paymentState,
      serviceState: s.serviceState,
      provider: s.providerMode === "PAYPAL_SANDBOX" ? "PayPal Sandbox" : "MOCK",
      lastEvent: s.lastEvent ? `${s.lastEvent.source} · ${s.lastEvent.type}` : "None",
      attention: needsAttention(s, ATTENTION_STATES),
      slotsCommitted: s.slotsCommitted,
    }));
  }, [d]);

  const shown = useMemo(() => (attentionOnly ? rows.filter((r) => r.attention) : rows), [rows, attentionOnly]);

  const columns = useMemo<ColDef<Row>[]>(
    () => [
      { field: "id", headerName: "Reservation", pinned: "left", width: 150, valueFormatter: (p) => `…${String(p.value).slice(-8)}`, tooltipField: "id" },
      { field: "portId", headerName: "Port", width: 100 },
      { field: "plugIn", headerName: "Plug in", width: 105 },
      { field: "readyBy", headerName: "Ready by", width: 110 },
      { field: "energyKwh", headerName: "Energy (kWh)", width: 135, type: "numericColumn" },
      { field: "amount", headerName: "Amount", width: 115, type: "numericColumn", valueFormatter: (p) => money(p.value ?? 0) },
      { field: "discount", headerName: "Driver discount", width: 150, type: "numericColumn", valueFormatter: (p) => money(p.value ?? 0) },
      { field: "operatorGain", headerName: "Operator gain", width: 140, type: "numericColumn", valueFormatter: (p) => money(p.value ?? 0) },
      {
        field: "paymentState",
        headerName: "Payment",
        width: 210,
        filter: "agTextColumnFilter",
        cellRenderer: (p: ICellRendererParams<Row>) => (p.data ? <PaymentBadge state={p.data.paymentState} capacityConfirmed={p.data.slotsCommitted} /> : null),
      },
      { field: "serviceState", headerName: "Service", width: 170, cellRenderer: (p: ICellRendererParams<Row>) => (p.data ? <ServiceBadge state={p.data.serviceState} /> : null) },
      { field: "provider", headerName: "Provider", width: 140 },
      { field: "lastEvent", headerName: "Last event", flex: 1, minWidth: 220 },
    ],
    [],
  );

  const rowClassRules = useMemo<RowClassRules<Row>>(() => ({ "grid-row-attention": (p) => !!p.data?.attention }), []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label htmlFor="grid-search" className="label">
            Search reservations
          </label>
          <input id="grid-search" className="field" type="search" placeholder="Port, state, provider, event…" value={quick} onChange={(e) => setQuick(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-[14px] min-h-[44px]">
          <input type="checkbox" checked={attentionOnly} onChange={(e) => setAttentionOnly(e.target.checked)} />
          Needs attention only
        </label>
        <button type="button" className="btn" onClick={() => grid.current?.api.exportDataAsCsv({ fileName: `reservations-${d.nightOf}.csv` })}>
          Export CSV
        </button>
      </div>
      <div className="reservation-grid" style={{ height: Math.min(560, 56 + Math.max(shown.length, 4) * 44) }}>
        <AgGridReact<Row>
          ref={grid}
          theme={gridTheme}
          rowData={shown}
          columnDefs={columns}
          defaultColDef={{ sortable: true, filter: true, resizable: true }}
          quickFilterText={quick}
          rowHeight={44}
          rowClassRules={rowClassRules}
          getRowId={(p) => p.data.id}
          rowSelection={{ mode: "singleRow", checkboxes: false, enableClickSelection: true }}
          onRowClicked={(e) => e.data && onSelect(e.data.id)}
          onFirstDataRendered={(e) => {
            if (selectedId) e.api.getRowNode(selectedId)?.setSelected(true);
          }}
          overlayNoRowsTemplate="No reservations match."
        />
      </div>
      <p className="meta">
        {shown.length} of {rows.length} reservations · click a row to open its details · sort, filter and resize any column
      </p>
    </div>
  );
}
