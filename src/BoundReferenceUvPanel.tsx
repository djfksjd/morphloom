import React, {useEffect, useRef, useState} from 'react';
import {inspectBoundReferenceUv} from './engine/bound-reference-uv';
import {reconstructTranslatedSource} from './engine/translated-source';

type Receipt = Awaited<ReturnType<typeof inspectBoundReferenceUv>>;

/** Independent, read-only file inspection. Never modifies the editor project. */
export function BoundReferenceUvPanel(): React.JSX.Element {
  const [original, setOriginal] = useState<File | null>(null);
  const [current, setCurrent] = useState<File | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [modifiedSource,setModifiedSource] = useState<Awaited<ReturnType<typeof reconstructTranslatedSource>> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ticket = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {mounted.current = false; ticket.current++;};
  }, []);

  function choose(file: File | null, kind: 'original' | 'current'): void {
    ticket.current++;
    setReceipt(null);
    setModifiedSource(null);
    setBusy(false);
    setError('');
    const valid = file && file.size <= 256_000_000;
    if (file && !valid) setError('Each GLB must be at most 256 MB.');
    if (kind === 'original') setOriginal(valid ? file : null);
    else setCurrent(valid ? file : null);
  }

  async function inspect(): Promise<void> {
    if (!original || !current || busy) return;
    const attempt = ++ticket.current;
    setReceipt(null);
    setModifiedSource(null);
    setError('');
    setBusy(true);
    try {
      const [before, after] = await Promise.all([original.arrayBuffer(), current.arrayBuffer()]);
      if (!mounted.current || ticket.current !== attempt) return;
      const result = await inspectBoundReferenceUv(before, after);
      if (mounted.current && ticket.current === attempt) setReceipt(result);
    } catch (e) {
      if (mounted.current && ticket.current === attempt) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current && ticket.current === attempt) setBusy(false);
    }
  }

  async function reconstruct(): Promise<void> {
    if (!original || !current || busy || !receipt?.report.integrityPass) return;
    const attempt=++ticket.current;
    setModifiedSource(null);setReceipt(null);setError('');setBusy(true);
    try {
      const [before,after]=await Promise.all([original.arrayBuffer(),current.arrayBuffer()]);
      if(!mounted.current || ticket.current!==attempt)return;
      const result=await reconstructTranslatedSource(before,after);
      if(mounted.current && ticket.current===attempt){setModifiedSource(result);setReceipt(result.binding);}
    }catch(e){if(mounted.current && ticket.current===attempt)setError(e instanceof Error?e.message:String(e));}
    finally{if(mounted.current && ticket.current===attempt)setBusy(false);}
  }

  function saveModified(kind:'source'|'receipt'): void {
    if(!modifiedSource || busy)return;
    const text=kind==='source'?modifiedSource.sourceJson:JSON.stringify(modifiedSource.receipt,null,2);
    const blob=new Blob([text],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;
    a.download=kind==='source'?'morphloom-translated-source.json':'morphloom-translated-source-proof.json';a.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function save(): void {
    if (!receipt) return;
    const blob = new Blob([JSON.stringify(receipt, null, 2)], {type: 'application/json'});
    if (blob.size > 20_000_000) {setError('Report exceeds the 20 MB download budget.'); return;}
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'morphloom-bound-reference-uv.json';
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <details aria-label="Original/current GLB UV inspection">
    <summary>Original/current GLB UV inspection</summary>
    <p>Local files only. Checks declared source-preserving translations using the exact original GLB. UV inspection alone does not create editable IR or certify delivery. Files remain unchanged.</p>
    <label>Original GLB (max 256 MB)<input aria-label="Original reference GLB" type="file" accept=".glb" onChange={e => {choose(e.currentTarget.files?.[0] ?? null, 'original'); e.currentTarget.value = '';}} /></label>
    <label>Translated GLB (max 256 MB)<input aria-label="Translated reference GLB" type="file" accept=".glb" onChange={e => {choose(e.currentTarget.files?.[0] ?? null, 'current'); e.currentTarget.value = '';}} /></label>
    <p>Original: {original?.name ?? 'not selected'} · Current: {current?.name ?? 'not selected'}</p>
    <button type="button" disabled={!original || !current || busy} onClick={() => {void inspect();}}>Inspect bound reference UV</button>
    <p role="status">{busy ? 'Checking bound reference files' : error ? 'Bound reference UV: BLOCKED' : receipt ? `Bound reference UV: ${receipt.report.integrityPass ? 'PASS' : 'FAIL'}` : 'Choose both GLB files'}</p>
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={!receipt?.report.integrityPass || busy} onClick={()=>{void reconstruct();}}>Generate modified native source JSON</button>
    <p>Requires one embedded native elements source with identity parent datums. Keeps the original GLBs and their before-edit metadata unchanged. Reopen the separate saved source using Load JSON to continue editing and export again.</p>
    {modifiedSource && !error && <>
      <p role="status">Modified native source: VERIFIED · {modifiedSource.receipt.target} · world translation {modifiedSource.receipt.translationMm.join(', ')} mm</p>
      <p>Source SHA256: {modifiedSource.receipt.sourceFingerprint}</p>
      <button type="button" disabled={busy} onClick={()=>saveModified('source')}>Save modified source JSON</button>
      <button type="button" disabled={busy} onClick={()=>saveModified('receipt')}>Save source regeneration proof</button>
    </>}
    {receipt && <>
      <p>Current editable IR available: false · Source metadata: before-edit reference</p>
      <p>Original SHA256: {receipt.sourceFingerprint}<br />Current SHA256: {receipt.outputFingerprint}</p>
      <ul>{receipt.report.meshes.map((mesh, i) => <li key={`${mesh.id}/${i}`}>
        {mesh.id}: {mesh.integrityPass ? 'PASS' : 'FAIL'} · Connected feature integrity: {mesh.criticalFeatures} · UV degenerate {mesh.degenerateUvTriangles}/{mesh.eligibleUvTriangles}
        {mesh.blocked && <p>{mesh.blocked}</p>}
        <p>Texel density: {mesh.texelDensity.status} · {mesh.texelDensity.reason}</p>
        {mesh.features.length > 0 && <details><summary>{mesh.features.length} connected feature results</summary><ul>{mesh.features.map(feature => <li key={feature.id}>{feature.id}: {feature.integrityPass ? 'PASS' : 'FAIL'} · {feature.degenerateUvTriangles}/{feature.triangles} degenerate UV triangles</li>)}</ul></details>}
      </li>)}</ul>
      <button type="button" onClick={save}>Save bound reference UV report</button>
    </>}
  </details>;
}
