import { DriverFlow } from "./DriverFlow";

export const metadata = { title: "Request a flexible charge · GridWindow FlexPay" };

export default async function DrivePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error.slice(0, 64) : null;
  return <DriverFlow initialError={error} />;
}
