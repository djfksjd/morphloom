import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ViewerApp } from './ViewerApp';
import { installBrowserProofRecorder } from './engine/browser-proof-recorder';
import './viewer-styles.css';
import ElementEditor from './ElementEditor';
import WorkspaceEditor from './WorkspaceEditor';

installBrowserProofRecorder();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(window.location.search).get('editor') === 'workspace' ? <WorkspaceEditor /> : new URLSearchParams(window.location.search).get('editor') === 'elements' ? <ElementEditor /> : <ViewerApp />}
  </StrictMode>,
);
