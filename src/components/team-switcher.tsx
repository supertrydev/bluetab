import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import bluetabAvatar from "@/assets/bluetab-avatar.png"
import { useTranslation } from "react-i18next"

export function TeamSwitcher() {
  const { t } = useTranslation()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          className="cursor-default hover:bg-transparent"
        >
          <img
            src={bluetabAvatar}
            alt="Bluetab"
            className="size-8 rounded-md"
          />
          <div className="grid flex-1 text-start text-sm leading-tight">
            <span className="truncate font-semibold">Bluetab</span>
            <span className="truncate text-xs">{t('components.teamSwitcher.tabManager')}</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
