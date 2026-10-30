import 'i18next';
import type { EN_RESOURCES } from './runtime-resources';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: typeof EN_RESOURCES;
    };
  }
}
