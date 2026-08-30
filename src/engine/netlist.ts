import type { AssemblyIR, ElectricalPortIR } from './assembly-ir';
import { validateAssemblyIR } from './assembly-compiler';
import { validateElectricalHarness } from './connectivity';

export interface PhysicalNetlist {
  schema: 'morphloom.physical-netlist/0.1';
  product: string;
  generatedFrom: 'AssemblyIR';
  scope: string;
  summary: {
    components: number;
    ports: number;
    connections: number;
    physicalPinLabels: number;
    gauges: number;
    verificationRecords: number;
    pendingBenchChecks: number;
  };
  connections: Array<{
    no: number;
    id: string;
    net: string;
    from: ElectricalPortIR;
    to: ElectricalPortIR;
    signal: string;
    gauge?: string;
    shielded: boolean;
    verification?: string;
  }>;
  passiveNodes: NonNullable<AssemblyIR['electrical']>['passiveNodes'];
  benchChecks: NonNullable<AssemblyIR['electrical']>['benchChecks'];
}

/** Builds an assembler-facing audit document from the same IR used for 3D. */
export function buildPhysicalNetlist(value: unknown): PhysicalNetlist {
  validateAssemblyIR(value);
  const harness = value.electrical;
  if (!harness) throw new Error('AssemblyIR has no electrical harness to export.');
  validateElectricalHarness(harness, new Set(value.components.map((component) => component.id)));
  const ports = new Map(harness.ports.map((port) => [port.id, port]));
  const connections = harness.wires.map((wire, index) => {
    const from = ports.get(wire.from);
    const to = ports.get(wire.to);
    if (!from || !to) throw new Error(`Wire ${wire.id} has an unresolved endpoint.`);
    return {
      no: index + 1,
      id: wire.id,
      net: wire.net,
      from: structuredClone(from),
      to: structuredClone(to),
      signal: wire.signal,
      gauge: wire.gauge,
      shielded: Boolean(wire.shielded),
      verification: wire.verification,
    };
  });
  return {
    schema: 'morphloom.physical-netlist/0.1',
    product: value.name,
    generatedFrom: 'AssemblyIR',
    scope: harness.verificationScope ?? 'digital graph only; physical continuity requires bench verification',
    summary: {
      components: value.components.length,
      ports: harness.ports.length,
      connections: harness.wires.length,
      physicalPinLabels: harness.ports.filter((port) => Boolean(port.physicalPin)).length,
      gauges: harness.wires.filter((wire) => Boolean(wire.gauge)).length,
      verificationRecords: harness.wires.filter((wire) => Boolean(wire.verification)).length,
      pendingBenchChecks: harness.benchChecks?.filter((check) => check.status !== 'passed').length ?? 0,
    },
    connections,
    passiveNodes: structuredClone(harness.passiveNodes ?? []),
    benchChecks: structuredClone(harness.benchChecks ?? []),
  };
}
