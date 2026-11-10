import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Selector nativo con el estilo de los campos (más accesible y fiable en móvil que un menú personalizado). */
export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 w-full rounded-lg border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
