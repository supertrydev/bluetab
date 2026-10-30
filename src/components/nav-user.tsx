"use client"

import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  ChevronsUpDown,
  CircleStar,
  LogIn,
  LogOut,
  RefreshCw,
  User,
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
  useSidebarSide,
} from "@/components/ui/sidebar"
import { useAuth } from "@/components/auth/useAuth"
import { LoginModal } from "@/components/auth/LoginModal"
import { ProBadge } from "@/components/auth/ProBadge"
import { UpgradeToProLabel } from "@/components/auth/UpgradeToProButton"
import { SyncStatusIndicator } from "@/components/sync"
import { config } from "@/config/config"

export function NavUser() {
  const { t } = useTranslation()
  const { isMobile } = useSidebar()
  const sidebarSide = useSidebarSide()
  const { isLoggedIn, isLoading, user, isPro, logout, refresh } = useAuth()
  const [showLoginModal, setShowLoginModal] = useState(false)
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

  if (!isLoggedIn) {
    return (
      <>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              onClick={() => setShowLoginModal(true)}
              className="hover:bg-sidebar-accent"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-accent">
                <User className="h-4 w-4" />
              </div>
              <div className="grid flex-1 text-start text-sm leading-tight">
                <span className="truncate font-semibold">{t('navigation.user.signIn')}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {t('navigation.user.accessPremium')}
                </span>
              </div>
              <LogIn className="ms-auto h-4 w-4" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <LoginModal
          isOpen={showLoginModal}
          onClose={() => setShowLoginModal(false)}
        />
      </>
    )
  }

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
                  <AvatarImage src="" alt={user?.name || user?.email} />
                  <AvatarFallback className="rounded-lg bg-primary text-white">
                    {getInitials(user?.name ?? undefined, user?.email ?? undefined)}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-start text-sm leading-tight">
                  <bdi dir="auto" className="truncate font-semibold">
                    {user?.name || t('navigation.user.user')}
                  </bdi>
                  {isPro ? (
                    <span className="truncate text-xs"><ProBadge size="sm" /></span>
                  ) : (
                    <bdi dir="ltr" className="truncate text-xs">{user?.email}</bdi>
                  )}
                </div>
                <SyncStatusIndicator className="ms-auto" />
                <ChevronsUpDown className="size-4 shrink-0" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
              side={isMobile ? "bottom" : sidebarSide === "left" ? "right" : "left"}
              align="end"
              sideOffset={4}
            >
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-start text-sm">
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarImage src="" alt={user?.name || user?.email} />
                    <AvatarFallback className="rounded-lg bg-primary text-white">
                      {getInitials(user?.name ?? undefined, user?.email ?? undefined)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-start text-sm leading-tight">
                    <bdi dir="auto" className="truncate font-semibold">
                      {user?.name || t('navigation.user.user')}
                    </bdi>
                    {isPro ? (
                      <span className="truncate text-xs"><ProBadge size="sm" /></span>
                    ) : (
                      <bdi dir="ltr" className="truncate text-xs">{user?.email}</bdi>
                    )}
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {isPro ? (
                  <DropdownMenuItem onClick={handleManageSubscription}>
                    <CircleStar className="text-primary" />
                    {t('navigation.user.manageSubscription')}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={handleUpgrade}>
                    <CircleStar />
                    <UpgradeToProLabel />
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={handleRefresh} disabled={isRefreshing}>
                  <RefreshCw className={isRefreshing ? "animate-spin" : ""} />
                  {t('navigation.user.refreshStatus')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout}>
                <LogOut />
                {t('navigation.user.signOut')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
      />
    </>
  )
}
