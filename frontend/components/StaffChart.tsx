"use client";

import type { StaffChartPoint } from "@/lib/types";
import { LineChart } from "./Charts";

/** Doctors vs nurses on staff at the end of each month (hospital admin dashboard). */
export default function StaffChart({ data }: { data: StaffChartPoint[] }) {
  return (
    <LineChart
      ariaLabel="Doctors and nurses on staff, last 6 months"
      labels={data.map((d) => d.month)}
      series={[
        { label: "Doctors", values: data.map((d) => d.doctors) },
        { label: "Nurses", values: data.map((d) => d.nurses) },
      ]}
    />
  );
}
