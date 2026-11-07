import { ReservationStatus } from "./ReservationStatus";

export const metadata = { title: "Your reservation · GridWindow FlexPay" };

export default async function ReservationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReservationStatus id={id} />;
}
