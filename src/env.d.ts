/// <reference types="vite/client" />
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

/** Short commit id of the build (see vite.config.ts); 'dev' when unknown. */
declare const __APP_VERSION__: string
