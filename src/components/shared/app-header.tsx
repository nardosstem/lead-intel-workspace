import { ThemeToggle } from "@/components/shared/theme-toggle";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur sm:px-6">
      <SidebarTrigger />
      <div className="h-4 w-px bg-border" aria-hidden="true" />
      <p className="text-sm font-medium">Lead Intel Workspace</p>
      <div className="ml-auto">
        <ThemeToggle />
      </div>
    </header>
  );
}
