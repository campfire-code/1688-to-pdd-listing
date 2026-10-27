import React from 'react';
import ReactDOM from 'react-dom/client';
import { KitApp, KitErrorBoundary } from './kit/App';
import tool from './tool';
import meta from '../tool.json';
import type { ToolMeta } from './kit/types';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <KitErrorBoundary><KitApp tool={{ ...tool, name: meta.name }} meta={meta as ToolMeta} /></KitErrorBoundary>
  </React.StrictMode>,
);
