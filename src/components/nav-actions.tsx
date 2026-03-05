"use client"

import { SquaresExclude, PanelRight } from "lucide-react"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

interface NavActionsProps {
  onSaveAllTabs?: () => void
}

async function openSidePanel() {
  try {
    // Get the current window to open side panel in
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.windowId) {
      await chrome.sidePanel.open({ windowId: tab.windowId })
    }
  } catch (error) {
    console.error('Failed to open side panel:', error)
  }
}

export function NavActions({ onSaveAllTabs }: NavActionsProps) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Fast Actions</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip="Save Current Tabs"
            onClick={onSaveAllTabs}
            className="bg-primary text-white hover:bg-primary/90 hover:text-white"
          >
            <SquaresExclude />
            <span>Save Current Tabs</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip="Open Side Panel"
            onClick={openSidePanel}
          >
            <PanelRight />
            <span>Side Panel</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}
