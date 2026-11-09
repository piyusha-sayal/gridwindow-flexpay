import { ScheduleBoard } from "./ScheduleBoard";

export const metadata = { title: "Operator schedule · GridWindow FlexPay" };

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;

/** `?night=YYYY-MM-DD` selects a night; anything else falls back to the server's default night. */
export default async function OperatorSchedulePage({ searchParams }: { searchParams: Promise<{ night?: string }> }) {
  const { night } = await searchParams;
  return <ScheduleBoard nightOf={night && NIGHT.test(night) ? night : null} />;
}
