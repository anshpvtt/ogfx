import { Suspense } from "react";
import AuthClient from "../AuthClient";

export default function LoginPage() {
  return (
    <Suspense>
      <AuthClient initialMode="login" />
    </Suspense>
  );
}
