import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ViewerApp } from './ViewerApp';
import { installBrowserProofRecorder } from './engine/browser-proof-recorder';
import './viewer-styles.css';

installBrowserProofRecorder();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ViewerApp />
  </StrictMode>,
);
