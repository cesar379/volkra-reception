import type { LucideIcon } from "lucide-react";
import { Headset } from "lucide-react";

/**
 * Productos de Volkra Hub. Reception es el primero; los siguientes se añaden aquí y aparecen en
 * «Productos» y en el menú.
 */
export type Product = { key: string; name: string; tagline: string; description: string; href: string; icon: LucideIcon; status: "active" | "soon" };

export const PRODUCTS: Product[] = [
  {
    key: "reception",
    name: "Reception",
    tagline: "Recepcionista con IA",
    description: "Atiende llamadas, WhatsApp y el chat de tu web: informa, da, cambia y cancela citas en tu agenda, y te deja los recados.",
    href: "/panel",
    icon: Headset,
    status: "active",
  },
];
