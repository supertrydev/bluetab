"use client"

import { type LucideIcon } from "lucide-react"

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
}: {
  items: {
    title: string
    url: string
    icon?: LucideIcon
    isActive?: boolean
    action?: string
  }[]
  onNavigateToGroups?: () => void
}) {
  const handleClick = (item: typeof items[0]) => {
    if (item.action === "settings") {
      window.location.href = chrome.runtime.getURL('src/settings/index.html')
    } else if (item.action === "groups") {
      if (onNavigateToGroups) {
        onNavigateToGroups()
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
      <SidebarGroupLabel>Menu</SidebarGroupLabel>
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
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
