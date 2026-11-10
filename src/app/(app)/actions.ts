"use server";

import { redirect } from "next/navigation";
import { setActiveBusiness } from "@/server/auth";

export async function switchBusiness(formData: FormData) {
  await setActiveBusiness(String(formData.get("businessId") ?? ""));
  redirect("/panel");
}
