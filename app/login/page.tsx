import { redirect } from "next/navigation";

export const metadata = {
  title: "Team login",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  redirect("/admin");
}
