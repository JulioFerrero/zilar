import type { ReactNode } from 'react';
import './index.css';

/** Global Cosmos decorator: dark-only frame matching the app page. */
export default function CosmosDecorator({ children }: { children: ReactNode }) {
  return <div className="bg-page p-6 font-sans text-foreground">{children}</div>;
}
