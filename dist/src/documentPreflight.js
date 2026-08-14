import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveInsideRoot } from './localProject.js';
function lineNumberAt(text, offset) {
    return text.slice(0, offset).split('\n').length;
}
function isEscaped(text, offset) {
    let backslashes = 0;
    for (let index = offset - 1; index >= 0 && text[index] === '\\'; index -= 1)
        backslashes += 1;
    return backslashes % 2 === 1;
}
function stripComments(text) {
    return text.split('\n').map((line) => {
        for (let index = 0; index < line.length; index += 1) {
            if (line[index] === '%' && !isEscaped(line, index))
                return line.slice(0, index);
        }
        return line;
    }).join('\n');
}
export function inspectLatexStructure(text, isLatex = true) {
    const source = stripComments(text);
    const errors = [];
    const warnings = [];
    const braceStack = [];
    const environmentStack = [];
    for (let index = 0; index < source.length; index += 1) {
        if ((source[index] === '{' || source[index] === '}') && !isEscaped(source, index)) {
            if (source[index] === '{')
                braceStack.push(index);
            else if (braceStack.length === 0) {
                errors.push(`Unmatched closing brace on line ${lineNumberAt(source, index)}.`);
            }
            else
                braceStack.pop();
        }
    }
    for (const offset of braceStack.slice(0, 20)) {
        errors.push(`Unmatched opening brace on line ${lineNumberAt(source, offset)}.`);
    }
    const environmentPattern = /\\(begin|end)\s*\{([^{}]+)\}/g;
    let match;
    while ((match = environmentPattern.exec(source)) !== null) {
        const kind = match[1];
        const name = match[2].trim();
        const line = lineNumberAt(source, match.index);
        if (kind === 'begin') {
            environmentStack.push({ name, line });
        }
        else if (environmentStack.length === 0) {
            errors.push(`Unexpected \\end{${name}} on line ${line}.`);
        }
        else {
            const open = environmentStack.pop();
            if (open?.name !== name) {
                errors.push(`Environment mismatch on line ${line}: opened ${open?.name} on line ${open?.line}, closed ${name}.`);
            }
        }
        if (errors.length >= 20)
            break;
    }
    for (const open of environmentStack.slice().reverse().slice(0, 20)) {
        errors.push(`Unclosed environment ${open.name} opened on line ${open.line}.`);
    }
    if (isLatex && !/\\documentclass\s*(?:\[[^\]]*\])?\s*\{/i.test(source)) {
        warnings.push('No \\documentclass was found; this may be an included fragment rather than a main document.');
    }
    return { ok: errors.length === 0, errors: errors.slice(0, 20), warnings };
}
function runProcess(command, args, cwd, timeoutMs) {
    return new Promise((resolve) => {
        let output = '';
        let settled = false;
        let timedOut = false;
        let child;
        try {
            child = spawn(command, args, { cwd, windowsHide: true });
        }
        catch {
            resolve({ started: false, ok: false, output: '', timedOut: false });
            return;
        }
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            resolve({ ...result, output: output.slice(-12_000) });
        };
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
            finish({ started: true, ok: false, output, timedOut });
        }, timeoutMs);
        child.stdout?.on('data', (chunk) => { output += chunk.toString(); });
        child.stderr?.on('data', (chunk) => { output += chunk.toString(); });
        child.once('error', (error) => {
            clearTimeout(timer);
            finish({ started: error.code !== 'ENOENT', ok: false, output, timedOut });
        });
        child.once('close', (code) => {
            clearTimeout(timer);
            finish({ started: true, ok: code === 0, output, timedOut });
        });
    });
}
async function compileLatex(workingRoot, compilePath, timeoutMs) {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'overleaf-document-preflight-'));
    try {
        const engines = [
            {
                name: 'latexmk',
                args: ['-pdf', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', `-outdir=${temporary}`, compilePath],
            },
            { name: 'tectonic', args: ['--keep-logs', '--outdir', temporary, compilePath] },
            {
                name: 'pdflatex',
                args: ['-interaction=nonstopmode', '-halt-on-error', '-file-line-error', `-output-directory=${temporary}`, compilePath],
            },
        ];
        for (const engine of engines) {
            const result = await runProcess(engine.name, engine.args, workingRoot, timeoutMs);
            if (!result.started)
                continue;
            return {
                attempted: true,
                available: true,
                ok: result.ok,
                engine: engine.name,
                output: result.output,
                timedOut: result.timedOut,
            };
        }
        return { attempted: true, available: false, ok: null, engine: null, output: '', timedOut: false };
    }
    finally {
        await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined);
    }
}
export async function preflightLocalDocument(input) {
    if (path.resolve(input.baselineRoot) === path.resolve(input.workingRoot)) {
        throw new Error('baseline_root and working_root must be separate directories.');
    }
    const syntax = inspectLatexStructure(input.workingText, /\.tex$/i.test(input.filePath));
    const shouldCompile = input.compile !== false && /\.tex$/i.test(input.compilePath || input.filePath);
    const compilePath = input.compilePath || input.filePath;
    resolveInsideRoot(input.workingRoot, compilePath);
    const compilation = shouldCompile
        ? await compileLatex(input.workingRoot, compilePath, input.compileTimeoutMs || 90_000)
        : { attempted: false, available: false, ok: null, engine: null, output: '', timedOut: false };
    return {
        ok: input.localPlan.ok && syntax.ok && (compilation.ok !== false),
        filePath: input.filePath,
        workingRoot: input.workingRoot,
        localPlan: input.localPlan,
        syntax,
        compilation,
    };
}
//# sourceMappingURL=documentPreflight.js.map