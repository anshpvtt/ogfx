import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

type CookieToSet = { name: string; value: string; options?: any };

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const cronSecret = process.env.CRON_SECRET;
  const isCronAuthorized =
    Boolean(cronSecret) && request.headers.get("authorization") === `Bearer ${cronSecret}`;
  const isProtected =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/api/agent") ||
    pathname.startsWith("/api/backtest") ||
    pathname.startsWith("/api/demo") ||
    pathname.startsWith("/api/signals/generate") ||
    pathname.startsWith("/api/stripe/checkout") ||
    pathname.startsWith("/api/stripe/portal");

  if (pathname.startsWith("/api/agent") && isCronAuthorized) {
    return response;
  }

  if (isProtected && !user) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/auth/login";
    redirectUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && (pathname === "/auth" || pathname === "/auth/login" || pathname === "/auth/signup" || pathname === "/signup")) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  if (user && pathname.startsWith("/api/signals/generate")) {
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("plan,status")
      .eq("user_id", user.id)
      .in("status", ["active", "trialing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!subscription || subscription.plan === "free") {
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const { count } = await supabase
        .from("signals")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("created_at", monthStart.toISOString());

      if ((count ?? 0) >= 5) {
        return NextResponse.json({ error: "Free plan signal limit exceeded" }, { status: 403 });
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
