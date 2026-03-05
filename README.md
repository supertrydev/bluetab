# <img align="center" width="40" src="docs/images/logo.png" alt="BlueTab Logo"> BlueTab

<img src="docs/images/hero.png" width="100%" alt="BlueTab Manager Dashboard">

**Advanced tab management for Chrome with encryption, powerful search, and automation.**

BlueTab is an open-source extension born from the need to organize the chaos of too many tabs. It's built with modern web technologies to be lightning-fast, secure, and beautiful.

## Why BlueTab?

- **Never lose tabs again** - Save hundreds of tabs into organized groups.
- **Bank-grade security** - Local AES-256 encryption for sensitive tab collections.
- **Lightning fast** - Search 1000+ tabs in under 50ms.
- **Smart automation** - Flow rules auto-organize tabs by URL patterns *(Cloud/Premium - Coming Soon)*.

## Quick Start

<img src="docs/images/sidebar.png" width="300" alt="BlueTab Sidebar Interface">

```bash
npm install          # Install dependencies
npm run dev          # Start development mode
# Load dist/ folder in chrome://extensions (Developer mode)
```

## Features

### Tab Management
- Save all tabs with one click (`Alt+Shift+S`)
- Restore groups in new window or merge
- Pin, collapse, and tag groups
- Full-text search with fuzzy matching

### Security
- AES-GCM encryption (256-bit)
- PBKDF2 key derivation (100k iterations)
- Zero telemetry, local-only storage

### Flow Automation *(Coming Soon)*

- URL-based auto-grouping rules
- Title pattern matching with regex
- Drag-and-drop rule priority

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                        USER INTERFACES                          │
├──────────┬──────────┬──────────┬──────────┬───────────────────┤
│  Popup   │ Options  │ Settings │  Flow    │    Account        │
│ (Quick)  │  (Full)  │ (Config) │  (Auto)  │    (Auth)         │
└────┬─────┴────┬─────┴────┬─────┴────┬─────┴─────────┬─────────┘
     │          │          │          │               │
     └──────────┴──────────┴──────────┴───────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SERVICE LAYER                               │
├─────────────────┬─────────────────┬─────────────────────────────┤
│  archive-       │  password-      │  archive-search-            │
│  service.ts     │  CRUD           │  (Search & Analytics)       │
├─────────────────┴─────────────────┴─────────────────────────────┤
│  restoration-service.ts (Smart tab restoration)                 │
├─────────────────────────────────────────────────────────────────┤
│  flow-service.ts (URL/title matching, rule execution) [PRO]     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     UTILITY LAYER                               │
├────────────┬────────────┬────────────┬────────────┬────────────┤
│  storage   │  crypto    │  dedupe    │  normalize │  sorting   │
│            │  (AES-GCM) │            │  (URLs)    │            │
├────────────┴────────────┴────────────┴────────────┴────────────┤
│  auth-state.ts (encrypted token storage)                       │
│  feature-gate.ts (premium feature access control)              │
│  flow-storage.ts (Flow rules CRUD)                             │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     CHROME APIS                                 │
├─────────────┬─────────────┬─────────────┬─────────────────────┤
│  tabs       │  storage    │  tabGroups  │  contextMenus       │
│             │  .local     │             │                     │
└─────────────┴─────────────┴─────────────┴─────────────────────┘
```

## Configuration & Local Setup

No `.env` file needed for local core features. All settings are stored locally in Chrome extension storage.

User-configurable options in Settings page:
- Theme (dark/light/system)
- Text size (small/medium/large)
- Auto-backup interval
- Tab group restore mode

### Loading in Chrome

1. Run `npm run build`
2. Open `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the `dist/` folder

## BlueTab Core vs Cloud Features

BlueTab is developed using an open-core model. The core extension is 100% free and runs locally. Advanced sync and team capabilities are planned as opt-in premium services supported by Supertry.

| Feature | Free (OSS Core) | Premium (Coming Soon) |
|---------|-----------------|-----------------------|
| Save & restore tabs | ✅ | ✅ |
| Full-text search | ✅ | ✅ |
| Local AES-256 encryption | ✅ | ✅ |
| Tags & pinning | ✅ | ✅ |
| Import/Export | ✅ | ✅ |
| **Flow automation** | ❌ | ✅ |
| Cloud sync via Supertry | ❌ | 🔜 |

## Contributing

<a href="https://github.com/supertrydev/bluetab/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=supertrydev/bluetab" />
</a>

BlueTab is open-source and we welcome contributions! Whether it's reporting a bug, suggesting a feature, or writing code, your help is appreciated. 
1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

MIT - Built with React, TypeScript, shadcn/ui, and Tailwind CSS.
