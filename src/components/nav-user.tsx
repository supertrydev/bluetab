"use client"

import { useState } from "react"
import {
  ChevronsUpDown,
  Crown,
  RefreshCw,
  User,
  LogOut,
} from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useAuth } from "@/components/auth/useAuth"
import { ProBadge } from "@/components/auth/ProBadge"
import { SyncStatusIndicator } from "@/components/sync"
import { config } from "@/config/config"

export function NavUser() {
  const { isMobile } = useSidebar()
  const { isLoading, user, isPro, logout, refresh } = useAuth()
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await refresh()
    setIsRefreshing(false)
  }

  const handleManageSubscription = () => {
    window.location.href = chrome.runtime.getURL('src/account/index.html')
  }

  const handleUpgrade = () => {
    chrome.tabs.create({ url: `${config.supertry.baseUrl}/dashboard?upgrade=bluetab-pro` })
  }

  const getInitials = (name?: string, email?: string) => {
    if (name) return name[0].toUpperCase()
    if (email) return email[0].toUpperCase()
    return "U"
  }

  if (isLoading) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" className="animate-pulse">
            <div className="h-8 w-8 rounded-lg bg-sidebar-accent" />
            <div className="grid flex-1 gap-1">
              <div className="h-4 w-20 rounded bg-sidebar-accent" />
              <div className="h-3 w-16 rounded bg-sidebar-accent" />
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <div className="flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-accent">
            <User className="h-4 w-4" />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">Local User</span>
            <span className="truncate text-xs text-muted-foreground">
              Open Source Edition
            </span>
          </div>
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  )

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src="" alt={user?.name || user?.email || ""} />
                  <AvatarFallback className="rounded-lg bg-primary text-white">
                    {getInitials(user?.name, user?.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    {user?.name || "User"}
                  </span>
                  <span className="truncate text-xs">
                    {isPro ? <ProBadge size="sm" /> : user?.email}
                  </span>
                </div>
                <SyncStatusIndicator className="ml-auto" />
                <ChevronsUpDown className="size-4 shrink-0" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
              side={isMobile ? "bottom" : "right"}
              align="end"
              sideOffset={4}
            >
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarImage src="" alt={user?.name || user?.email || ""} />
                    <AvatarFallback className="rounded-lg bg-primary text-white">
                      {getInitials(user?.name, user?.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">
                      {user?.name || "User"}
                    </span>
                    <span className="truncate text-xs">
                      {isPro ? <ProBadge size="sm" /> : user?.email}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {isPro ? (
                  <DropdownMenuItem onClick={handleManageSubscription}>
                    <Crown className="text-primary" />
                    Manage Subscription
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={handleUpgrade}>
                    <Crown />
                    Upgrade to Pro
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={handleRefresh} disabled={isRefreshing}>
                  <RefreshCw className={isRefreshing ? "animate-spin" : ""} />
                  Refresh Status
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout}>
                <LogOut />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  )
}
