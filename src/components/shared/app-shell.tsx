import { Suspense } from "react";

import { AppHeader } from "@/components/shared/app-header";
import { AppSidebar } from "@/components/shared/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getCurrentOrganizationName, getCurrentUser } from "@/lib/auth/user";

export async function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  const organizationName = user ? await getCurrentOrganizationName(user.id) : null;

  return (
    <SidebarProvider>
      <Suspense fallback={null}>
        <AppSidebar organizationName={organizationName} />
      </Suspense>
      <SidebarInset>
        <AppHeader email={user?.email ?? null} organizationName={organizationName} />
        <div className="flex flex-1 p-4 sm:p-6 lg:p-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
