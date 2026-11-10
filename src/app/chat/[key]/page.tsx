import { notFound } from "next/navigation";
import { bookingDeps } from "@/server/deps";
import { businessByChatKey, chatGreeting } from "@/server/webchat/session";
import { ChatWindow } from "./chat-window";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/chat/[key]">) {
  const business = await businessByChatKey(await bookingDeps(), (await params).key);
  return { title: { absolute: business ? `Chat · ${business.name}` : "Chat" } };
}

export default async function ChatPage({ params, searchParams }: PageProps<"/chat/[key]">) {
  const { key } = await params;
  const business = await businessByChatKey(await bookingDeps(), key);
  if (!business) notFound();
  const embed = (await searchParams).embed === "1";
  return <ChatWindow chatKey={key} businessName={business.name} greeting={chatGreeting(business)} embed={embed} />;
}
