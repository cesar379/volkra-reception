"use server";

import { revalidatePath } from "next/cache";
import { requireApp } from "@/server/auth";

export async function resolveIssue(formData: FormData) {
  const ctx = await requireApp();
  const id = String(formData.get("id") ?? "");
  await ctx.asUser((q) => q.query(`update issues set resolved_at = now() where id = $1 and business_id = $2`, [id, ctx.business.id]));
  revalidatePath("/incidencias");
  revalidatePath("/panel");
}
