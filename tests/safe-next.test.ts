import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

describe("destino tras un enlace de email", () => {
  it("acepta rutas de la app", () => {
    expect(safeNext("/nueva-contrasena")).toBe("/nueva-contrasena");
    expect(safeNext("/configuracion?tab=equipo")).toBe("/configuracion?tab=equipo");
  });

  it("nunca manda a otra web", () => {
    for (const bad of ["https://otra.web", "//otra.web", "/\\otra.web", "otra.web", "", null, undefined]) {
      expect(safeNext(bad)).toBe("/panel");
    }
  });
});
