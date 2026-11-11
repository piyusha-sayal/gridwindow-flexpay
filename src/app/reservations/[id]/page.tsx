import { ReservationStatus } from "./ReservationStatus";

export const metadata = { title: "Your reservation · GridWindow FlexPay" };

export default async function ReservationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flow-shell">
      <span aria-hidden="true" className="flow-shell-glow" />
      <ReservationStatus id={id} />
    </div>
  );
}
