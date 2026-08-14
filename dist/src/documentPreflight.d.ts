import type { LocalFileChangePlan } from './localDiff.js';
export interface DocumentPreflightInput {
    baselineRoot: string;
    workingRoot: string;
    filePath: string;
    workingText: string;
    localPlan: LocalFileChangePlan;
    compile?: boolean;
    compilePath?: string;
    compileTimeoutMs?: number;
}
export interface DocumentPreflightOutput {
    ok: boolean;
    filePath: string;
    workingRoot: string;
    localPlan: LocalFileChangePlan;
    syntax: {
        ok: boolean;
        errors: string[];
        warnings: string[];
    };
    compilation: {
        attempted: boolean;
        available: boolean;
        ok: boolean | null;
        engine: string | null;
        output: string;
        timedOut: boolean;
    };
}
export declare function inspectLatexStructure(text: string, isLatex?: boolean): DocumentPreflightOutput['syntax'];
export declare function preflightLocalDocument(input: DocumentPreflightInput): Promise<DocumentPreflightOutput>;
