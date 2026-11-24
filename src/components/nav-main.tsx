"use client"

import { type LucideIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function NavMain({
  items,
  onNavigateToGroups,
  onNavigate,
  onWrappedClick,
}: {
  items: {
    title: string
    url: string
    icon?: LucideIcon
    isActive?: boolean
    action?: string
    badgeActive?: boolean
  }[]
  onNavigateToGroups?: () => void
  onNavigate?: (page: string) => void
  onWrappedClick?: () => void
}) {
  const { t } = useTranslation()

  const handleClick = (item: typeof items[0]) => {
    if (item.action === "wrapped") {
      if (onWrappedClick) {
        onWrappedClick()
      } else {
        window.location.href = chrome.runtime.getURL('src/options/index.html#wrapped')
      }
    } else if (item.action === "feeds") {
      window.location.href = chrome.runtime.getURL('src/feeds/index.html')
    } else if (item.action === "statistics" || item.action === "help" || item.action === "offline-reading") {
      if (onNavigate) {
        onNavigate(item.action)
      } else {
        window.location.href = chrome.runtime.getURL(`src/options/index.html#${item.action}`)
      }
    } else if (item.action === "settings") {
      window.location.href = chrome.runtime.getURL('src/settings/index.html')
    } else if (item.action === "groups") {
      if (onNavigateToGroups) {
        onNavigateToGroups()
      } else if (onNavigate) {
        onNavigate("groups")
      } else {
        window.location.href = chrome.runtime.getURL('src/options/index.html')
      }
    } else if (item.action === "account") {
      window.location.href = chrome.runtime.getURL('src/account/index.html')
    } else if (item.action === "flow") {
      window.location.href = chrome.runtime.getURL('src/flow/index.html')
    }
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t('navigation.menu')}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.title}>
            <SidebarMenuButton
              tooltip={item.title}
              isActive={item.isActive}
              onClick={() => handleClick(item)}
            >
              {item.icon && <item.icon />}
              <span>{item.title}</span>
              {item.badgeActive && (
                <span className="ms-auto h-2 w-2 rounded-full bg-warning animate-pulse" />
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
