/** @jest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DirectionProvider } from '@radix-ui/react-direction';
import { Folder } from 'lucide-react';

import { AppSidebar } from './app-sidebar';
import {
  Sidebar,
  SidebarGroup,
  SidebarGroupAction,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
} from './ui/sidebar';
import type { Project } from '@/types/models';
import { initI18n } from '@/i18n';

let mockIsMobile = false;

jest.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => mockIsMobile,
}));

jest.mock('@/assets/bluetab-avatar.png', () => 'bluetab-avatar.png');

jest.mock('./ProjectModal', () => ({
  PROJECT_ICONS: { folder: Folder },
}));

jest.mock('./auth/useAuth', () => ({
  useAuth: () => ({
    isLoggedIn: true,
    isLoading: false,
    user: { name: 'Alice اسم', email: 'alice@example.com' },
    isPro: false,
    logout: jest.fn(),
    refresh: jest.fn(),
  }),
}));

jest.mock('./sync', () => ({
  SyncStatusIndicator: () => <span data-testid="sync-status" />,
}));

jest.mock('@/services/bluet-bridge-service', () => ({
  BluetBridgeService: {
    getSharedRefs: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({
    children,
    side,
  }: {
    children: React.ReactNode;
    side?: string;
  }) => <div data-testid="tooltip-content" data-side-prop={side}>{children}</div>,
}));

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({
    children,
    side,
  }: {
    children: React.ReactNode;
    side?: string;
  }) => <div data-testid="dropdown-content" data-side-prop={side}>{children}</div>,
}));

const project: Project = {
  id: 'project-1',
  name: 'مشروع Alpha',
  color: 'blue',
  icon: 'folder',
  searchScope: 'project',
  created: 1,
  modified: 1,
};

describe('AppSidebar direction', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await initI18n({ language: 'ar' });
  });

  beforeEach(() => {
    mockIsMobile = false;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderWithDirection(direction: 'ltr' | 'rtl', child: React.ReactNode) {
    await act(async () => {
      root.render(
        <DirectionProvider dir={direction}>
          <SidebarProvider>{child}</SidebarProvider>
        </DirectionProvider>,
      );
    });
  }

  it('places the application navigation on the natural side without changing DOM order', async () => {
    await renderWithDirection('rtl', <AppSidebar projects={[project]} />);

    const sidebar = container.querySelector('[data-side]');
    expect(sidebar?.getAttribute('data-side')).toBe('right');

    const firstMenuButton = container.querySelector('[data-sidebar="menu-button"]');
    expect(firstMenuButton?.firstElementChild?.tagName.toLowerCase()).toBe('img');
  });

  it('uses the side-facing trigger icon for each application navigation direction', async () => {
    await renderWithDirection(
      'rtl',
      <>
        <AppSidebar />
        <SidebarTrigger />
      </>,
    );
    expect(container.querySelector('.lucide-panel-right')).not.toBeNull();
    expect(container.querySelector('.lucide-panel-left')).toBeNull();
  });

  it('keeps the LTR navigation on the left with the existing left-panel trigger', async () => {
    await renderWithDirection(
      'ltr',
      <>
        <AppSidebar />
        <SidebarTrigger />
      </>,
    );

    expect(container.querySelector('[data-side]')?.getAttribute('data-side')).toBe('left');
    expect(container.querySelector('.lucide-panel-left')).not.toBeNull();
    expect(container.querySelector('.lucide-panel-right')).toBeNull();
  });

  it('keeps the trigger icon aligned with an explicit physical sidebar side', async () => {
    await renderWithDirection(
      'rtl',
      <>
        <Sidebar side="left" />
        <SidebarTrigger />
      </>,
    );

    expect(container.querySelector('[data-side="left"]')).not.toBeNull();
    expect(container.querySelector('.lucide-panel-left')).not.toBeNull();
    expect(container.querySelector('.lucide-panel-right')).toBeNull();

    await renderWithDirection(
      'ltr',
      <>
        <Sidebar side="right" />
        <SidebarTrigger />
      </>,
    );

    expect(container.querySelector('[data-side="right"]')).not.toBeNull();
    expect(container.querySelector('.lucide-panel-right')).not.toBeNull();
    expect(container.querySelector('.lucide-panel-left')).toBeNull();
  });

  it('opens the mobile application navigation from the locale-aware physical side', async () => {
    mockIsMobile = true;
    await renderWithDirection(
      'rtl',
      <>
        <AppSidebar />
        <SidebarTrigger />
      </>,
    );

    await act(async () => {
      (container.querySelector('[data-sidebar="trigger"]') as HTMLButtonElement).click();
    });

    let mobileSidebar = document.body.querySelector('[data-mobile="true"]');
    expect(mobileSidebar?.getAttribute('data-side')).toBe('right');
    expect(mobileSidebar?.className).toContain('right-0');
    expect(mobileSidebar?.className).toContain('slide-in-from-right');

    await renderWithDirection(
      'ltr',
      <>
        <AppSidebar />
        <SidebarTrigger />
      </>,
    );

    mobileSidebar = document.body.querySelector('[data-mobile="true"]');
    expect(mobileSidebar?.getAttribute('data-side')).toBe('left');
    expect(mobileSidebar?.className).toContain('left-0');
    expect(mobileSidebar?.className).toContain('slide-in-from-left');
  });

  it('opens collapsed navigation affordances inward in RTL', async () => {
    await renderWithDirection(
      'rtl',
      <Sidebar side="right" collapsible="icon">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Settings">Settings</SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </Sidebar>,
    );

    expect(container.querySelector('[data-testid="tooltip-content"]')?.getAttribute('data-side-prop')).toBe('left');
  });

  it('isolates dynamic project and account text and opens desktop menus inward', async () => {
    await renderWithDirection('rtl', <AppSidebar projects={[project]} />);

    const projectName = Array.from(container.querySelectorAll('bdi')).find(
      (element) => element.textContent === project.name,
    );
    const userName = Array.from(container.querySelectorAll('bdi')).find(
      (element) => element.textContent === 'Alice اسم',
    );
    const email = Array.from(container.querySelectorAll('bdi')).find(
      (element) => element.textContent === 'alice@example.com',
    );

    expect(projectName?.getAttribute('dir')).toBe('auto');
    expect(userName?.getAttribute('dir')).toBe('auto');
    expect(email?.getAttribute('dir')).toBe('ltr');

    const dropdownSides = Array.from(container.querySelectorAll('[data-testid="dropdown-content"]'))
      .map((element) => element.getAttribute('data-side-prop'));
    expect(dropdownSides.length).toBeGreaterThan(0);
    expect(dropdownSides.every((side) => side === 'left')).toBe(true);
  });

  it('emits logical alignment utilities for reusable sidebar content', async () => {
    await renderWithDirection(
      'rtl',
      <Sidebar side="right">
        <SidebarGroup>
          <SidebarGroupAction data-testid="group-action">Action</SidebarGroupAction>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton data-testid="menu-button">Label</SidebarMenuButton>
              <SidebarMenuAction data-testid="menu-action">Action</SidebarMenuAction>
              <SidebarMenuBadge data-testid="menu-badge">1</SidebarMenuBadge>
              <SidebarMenuSub data-testid="menu-sub">
                <SidebarMenuSubItem>
                  <SidebarMenuSubButton data-testid="menu-sub-button">Child</SidebarMenuSubButton>
                </SidebarMenuSubItem>
              </SidebarMenuSub>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarInset data-testid="sidebar-inset" />
      </Sidebar>,
    );

    expect(container.querySelector('[data-testid="menu-button"]')?.className).toContain('text-start');
    expect(container.querySelector('[data-testid="menu-button"]')?.className).toContain(':pe-8');
    expect(container.querySelector('[data-testid="group-action"]')?.className).toContain('end-3');
    expect(container.querySelector('[data-testid="menu-action"]')?.className).toContain('end-1');
    expect(container.querySelector('[data-testid="menu-badge"]')?.className).toContain('end-1');
    expect(container.querySelector('[data-testid="menu-sub"]')?.className).toContain('border-s');
    expect(container.querySelector('[data-testid="menu-sub-button"]')?.className).toContain('rtl:translate-x-px');
    expect(container.querySelector('[data-testid="sidebar-inset"]')?.className).toContain(':ms-2');
  });
});
