"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

const config = {
  booked: { label: "Citas (reservas y cambios)", color: "var(--chart-1)" },
  info: { label: "Información", color: "var(--chart-2)" },
  transferred: { label: "Transferidas", color: "var(--chart-4)" },
  other: { label: "Recados y otras", color: "var(--chart-3)" },
} satisfies ChartConfig;

export function CallsChart({ data }: { data: { day: string; booked: number; info: number; transferred: number; other: number }[] }) {
  const rows = data.map((d) => ({
    ...d,
    label: new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d.day}T12:00:00Z`)),
  }));
  return (
    <ChartContainer config={config} className="h-64 w-full">
      <BarChart data={rows} margin={{ left: -16, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="booked" stackId="a" fill="var(--color-booked)" radius={[0, 0, 0, 0]} />
        <Bar dataKey="info" stackId="a" fill="var(--color-info)" />
        <Bar dataKey="transferred" stackId="a" fill="var(--color-transferred)" />
        <Bar dataKey="other" stackId="a" fill="var(--color-other)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
