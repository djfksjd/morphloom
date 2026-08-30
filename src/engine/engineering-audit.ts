import type { AssemblyIR, EvidenceStatusIR } from './assembly-ir';
import type { ConnectivityReport } from './connectivity';

export interface EngineeringAuditReport {
  components: number;
  componentEvidence: Record<EvidenceStatusIR | 'undocumented', number>;
  componentEvidenceCoverage: number;
  physicalPinCoverage: number;
  conductorGaugeCoverage: number;
  conductorVerificationCoverage: number;
  passiveNodes: number;
  outstandingBenchChecks: number;
  benchRequiredWires: number;
  inferredWires: number;
  digitalReady: boolean;
  productionReady: boolean;
  evidenceScore: number;
}

const ratio = (value: number, total: number): number => total > 0 ? value / total : 0;

/**
 * Separates deterministic digital checks from claims that require physical
 * inspection. This prevents a connected 3D graph from becoming a false
 * production-readiness score.
 */
export function inspectEngineeringEvidence(
  assembly: AssemblyIR,
  connectivity?: ConnectivityReport,
): EngineeringAuditReport {
  const componentEvidence: EngineeringAuditReport['componentEvidence'] = {
    measured: 0,
    datasheet: 0,
    estimated: 0,
    inferred: 0,
    undocumented: 0,
  };
  for (const component of assembly.components) {
    const status = component.evidence?.status ?? 'undocumented';
    componentEvidence[status] += 1;
  }

  const evidenceCoverage = ratio(assembly.components.length - componentEvidence.undocumented, assembly.components.length);
  const strongEvidenceCoverage = ratio(componentEvidence.measured + componentEvidence.datasheet, assembly.components.length);
  const estimatePenalty = ratio(componentEvidence.estimated, assembly.components.length) * 18;
  const inferencePenalty = ratio(componentEvidence.inferred, assembly.components.length) * 34;
  const evidenceScore = Math.round(Math.max(0, Math.min(100,
    42 + evidenceCoverage * 28 + strongEvidenceCoverage * 28 - estimatePenalty - inferencePenalty,
  )));

  const ports = connectivity?.ports ?? assembly.electrical?.ports.length ?? 0;
  const wires = connectivity?.wires ?? assembly.electrical?.wires.length ?? 0;
  const physicalPinCoverage = ratio(connectivity?.documentedPhysicalPins ?? 0, ports);
  const conductorGaugeCoverage = ratio(connectivity?.specifiedGaugeWires ?? 0, wires);
  const conductorVerificationCoverage = ratio(connectivity?.documentedVerificationWires ?? 0, wires);
  const outstandingBenchChecks = connectivity?.outstandingBenchChecks
    ?? assembly.electrical?.benchChecks?.filter((check) => check.status !== 'passed').length
    ?? 0;
  const digitalReady = connectivity !== undefined
    && connectivity.errors.length === 0
    && connectivity.connectedWires === connectivity.wires
    && connectivity.connectedRequiredPorts === connectivity.requiredPorts
    && physicalPinCoverage === 1
    && conductorGaugeCoverage === 1
    && conductorVerificationCoverage === 1;
  const productionReady = digitalReady
    && evidenceScore >= 90
    && componentEvidence.inferred === 0
    && outstandingBenchChecks === 0
    && (connectivity?.benchRequiredWires ?? 0) === 0
    && (connectivity?.inferredWires ?? 0) === 0;

  return {
    components: assembly.components.length,
    componentEvidence,
    componentEvidenceCoverage: evidenceCoverage,
    physicalPinCoverage,
    conductorGaugeCoverage,
    conductorVerificationCoverage,
    passiveNodes: assembly.electrical?.passiveNodes?.length ?? 0,
    outstandingBenchChecks,
    benchRequiredWires: connectivity?.benchRequiredWires ?? 0,
    inferredWires: connectivity?.inferredWires ?? 0,
    digitalReady,
    productionReady,
    evidenceScore,
  };
}
