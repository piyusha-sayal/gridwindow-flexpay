import { OperatorConsole } from "./OperatorConsole";

export const metadata = { title: "Operator console · GridWindow FlexPay" };

export default function OperatorPage() {
  return (
    <div className="ops-root">
      <span aria-hidden="true" className="ops-scan" />
      <OperatorConsole />
    </div>
  );
}
