/// <reference types="vite/client" />

declare module '*.yaml' {
  const data: unknown;
  export default data;
}

/** The version of package.json, set by vite.config.ts. */
declare const __APP_VERSION__: string;
