import { Suspense } from "react";
import AuthClient from "../AuthClient";

export default function SignupAuthPage() {
  return (
    <Suspense>
      <AuthClient initialMode="signup" />
    </Suspense>
  );
}
