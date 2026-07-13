import { redirect } from "next/navigation";

export default function MobileIndexPage(): never {
  redirect("/mobile/presence");
}
