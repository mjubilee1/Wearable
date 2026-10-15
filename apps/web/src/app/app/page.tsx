import { redirect } from "next/navigation";

/** Continue URL for the Firebase verification email. */
export default function AppContinuePage() {
  redirect("/activity");
}
