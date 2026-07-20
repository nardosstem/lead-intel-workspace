import { ThemeToggle } from "@/components/shared/theme-toggle";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { UserMenu } from "@/components/shared/user-menu";

export function AppHeader({
  email,
  organizationName,
}: Readonly<{
  email: string | null;
  organizationName: string | null;
}>) {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur sm:px-6">
      <SidebarTrigger />
      <div className="h-4 w-px bg-border" aria-hidden="true" />
      <p className="max-w-52 truncate text-sm font-medium" title={organizationName ?? "Lead Intel Workspace"}>
        {organizationName ?? "Lead Intel Workspace"}
      </p>
      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
        <UserMenu email={email} />
      </div>
    </header>
  );
}
