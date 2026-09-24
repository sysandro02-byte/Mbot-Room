import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export const isChunkLoadError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|Failed to load module script|ChunkLoadError|Loading chunk|dynamically imported module|error loading dynamically imported module/i.test(message);
};

export const lazyWithRetry = <T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
): LazyExoticComponent<T> => lazy(async () => {
  try {
    return await importer();
  } catch (firstError) {
    if (!navigator.onLine) throw firstError;
    await sleep(450);
    try {
      return await importer();
    } catch (secondError) {
      throw secondError;
    }
  }
});
