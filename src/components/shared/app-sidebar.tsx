"use client";

import { LayoutDashboard, Settings, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

const navigation = [
  { label: "Overview", href: "/", icon: LayoutDashboard, enabled: true },
  {
    label: "Lead workbench",
    href: "/lead-workbench",
    icon: Sparkles,
    enabled: false,
  },
  { label: "Settings", href: "/settings", icon: Settings, enabled: false },
] as const;

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b">
        <div className="flex h-10 items-center gap-2 px-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
            LI
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-semibold">Lead Intel</p>
            <p className="truncate text-xs text-muted-foreground">Workspace</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => (
                <SidebarMenuItem key={item.label}>
                  {item.enabled ? (
                    <SidebarMenuButton
                      render={<Link href={item.href} />}
                      isActive={pathname === item.href}
                      tooltip={item.label}
                    >
                      <item.icon aria-hidden="true" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  ) : (
                    <SidebarMenuButton
                      type="button"
                      disabled
                      tooltip={`${item.label} — coming next`}
                    >
                      <item.icon aria-hidden="true" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t">
        <p className="px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          Foundation phase
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
