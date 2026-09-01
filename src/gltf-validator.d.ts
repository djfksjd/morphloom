declare module 'gltf-validator' {
  export interface ValidationMessage {
    code: string;
    message: string;
    severity: number;
    pointer?: string;
    offset?: number;
  }

  export interface ValidationReport {
    validatorVersion?: string;
    issues?: {
      numErrors?: number;
      numWarnings?: number;
      numInfos?: number;
      numHints?: number;
      messages?: ValidationMessage[];
      truncated?: boolean;
    };
  }

  export function validateBytes(
    data: Uint8Array,
    options?: {
      uri?: string;
      format?: 'glb' | 'gltf';
      writeTimestamp?: boolean;
      maxIssues?: number;
      severityOverrides?: Record<string, number>;
    },
  ): Promise<ValidationReport>;
}
