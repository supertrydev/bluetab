"use client"

import { Moon, Sparkles, SquaresExclude } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

interface NavActionsProps {
  onSaveAllTabs?: () => void
  onSaveSuspendedTabs?: () => void
  onOrganizeGroups?: () => void
}

export function NavActions({ onSaveAllTabs, onSaveSuspendedTabs, onOrganizeGroups }: NavActionsProps) {
  const { t } = useTranslation()

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t('navigation.actions.label')}</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip={t('navigation.actions.saveCurrentTabs')}
            onClick={onSaveAllTabs}
            className="rounded-full bg-primary text-white shadow-sm hover:bg-primary-hover hover:text-white active:bg-primary-active active:text-white"
          >
            <SquaresExclude />
            <span>{t('navigation.actions.saveCurrentTabs')}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip={t('navigation.actions.saveSuspendedTabs')}
            onClick={onSaveSuspendedTabs}
          >
            <Moon />
            <span>{t('navigation.actions.saveSuspendedTabs')}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {onOrganizeGroups && (
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={t('navigation.actions.organizeGroups')}
              onClick={onOrganizeGroups}
            >
              <Sparkles />
              <span>{t('navigation.actions.organizeGroups')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
      </SidebarMenu>
    </SidebarGroup>
  )
}
