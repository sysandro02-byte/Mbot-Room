import type {
  Key as ReactKey,
  ReactElement as ReactElementType,
  ReactNode as ReactNodeType,
} from 'react';

declare global {
  namespace React {
    type ReactNode = ReactNodeType;
  }

  namespace JSX {
    type Element = ReactElementType;

    interface IntrinsicAttributes {
      key?: ReactKey | null;
    }
  }
}

export {};
