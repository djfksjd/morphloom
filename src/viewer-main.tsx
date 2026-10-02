import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { ViewerApp } from './ViewerApp';
import { installBrowserProofRecorder } from './engine/browser-proof-recorder';
import './viewer-styles.css';
import ElementEditor from './ElementEditor';
import WorkspaceEditor from './WorkspaceEditor';

const EvidenceEditor = lazy(() => import('./EvidenceEditor'));

installBrowserProofRecorder();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(window.location.search).get('editor') === 'evidence' ? <Suspense fallback={<p>사진 근거 편집기 불러오는 중…</p>}><EvidenceEditor /></Suspense> : new URLSearchParams(window.location.search).get('editor') === 'workspace' ? <WorkspaceEditor /> : new URLSearchParams(window.location.search).get('editor') === 'elements' ? <ElementEditor /> : <ViewerApp />}
  </StrictMode>,
);
