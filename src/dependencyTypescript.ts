import { posix as path } from 'path';
import * as ts from 'dependency-typescript';

export type TypescriptDependencyNodeKind = 'function' | 'class' | 'module-init';
export type TypescriptDependencyRelation = 'import' | 'reexport' | 'call' | 'construct' | 'reference';
export type TypescriptDependencyPhase = 'module-init' | 'invocation' | 'type' | 'unknown';
export type TypescriptDependencyResolution = 'resolved' | 'ambiguous' | 'unresolved' | 'external' | 'unsupported';

export interface TypescriptDependencyNode {
    id: string;
    name: string;
    kind: TypescriptDependencyNodeKind;
    start: number;
    end: number;
}

export interface TypescriptDependencyTarget {
    file: string;
    node?: string;
}

export interface TypescriptDependencySite {
    owner: string;
    relation: TypescriptDependencyRelation;
    name: string;
    start: number;
    end: number;
    phase: TypescriptDependencyPhase;
    resolution: TypescriptDependencyResolution;
    target?: TypescriptDependencyTarget;
    candidates?: TypescriptDependencyTarget[];
    specifier?: string;
    loading?: 'eager' | 'deferred';
    reason?: string;
}

export interface TypescriptDependencyDiagnostic {
    code: string;
    message: string;
}

export interface TypescriptDependencyDocument {
    status: 'complete' | 'invalid';
    nodes: TypescriptDependencyNode[];
    sites: TypescriptDependencySite[];
    diagnostics: TypescriptDependencyDiagnostic[];
}

export interface TypescriptDependencyAnalysis {
    producer: string;
    documents: Record<string, TypescriptDependencyDocument>;
}

const PRODUCER = `bygone-typescript/${ts.version}`;
const VIRTUAL_ROOT = '/__bygone_typescript_source__';
const MAX_NODES_PER_FILE = 5000;
const MAX_SITES_PER_FILE = 20000;
const MAX_DIAGNOSTICS_PER_FILE = 200;

type SitePhase = TypescriptDependencyPhase;
type RuntimeDeclaration = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction |
    ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration | ts.ConstructorDeclaration;
type RuntimeClass = ts.ClassDeclaration | ts.ClassExpression;

interface SourceInput {
    logical: string;
    internal: string;
    text: string;
    supported: boolean;
    sourceFile?: ts.SourceFile;
}

interface NodeRecord extends TypescriptDependencyNode {
    source: SourceInput;
    ast: ts.Node;
}

interface DocumentContext {
    source: SourceInput;
    output: TypescriptDependencyDocument;
    nodeByAst: Map<ts.Node, NodeRecord>;
    nodesById: Map<string, NodeRecord>;
    truncated: boolean;
    diagnosticKeys: Set<string>;
}

interface VisitContext {
    owner: NodeRecord;
    phase: SitePhase;
    skipReference?: boolean;
}

interface CandidateResult {
    candidates: NodeRecord[];
    signatureOnly: boolean;
    externalSpecifier?: string;
}

interface TargetResolution {
    resolution: TypescriptDependencyResolution;
    target?: TypescriptDependencyTarget;
    candidates?: TypescriptDependencyTarget[];
    reason?: string;
}

interface ModuleResolution {
    resolution: TypescriptDependencyResolution;
    target?: TypescriptDependencyTarget;
    reason?: string;
}

/**
 * Analyze only the JavaScript/TypeScript source strings supplied by the caller.
 * The compiler host deliberately has no filesystem, package, or default-library
 * access; a target is therefore resolved only when its source is in `files`.
 */
export function analyzeTypescriptDependencies(files: Record<string, string>): TypescriptDependencyAnalysis {
    const sources = createSources(files);
    const sourceByInternal = new Map(sources.map(source => [source.internal, source]));
    const contexts = new Map<string, DocumentContext>();
    for (const source of sources) contexts.set(source.internal, createDocumentContext(source));

    const compilerOptions: ts.CompilerOptions = {
        allowJs: true,
        checkJs: false,
        esModuleInterop: true,
        jsx: ts.JsxEmit.Preserve,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        noEmit: true,
        noLib: true,
        resolveJsonModule: false,
        skipLibCheck: true,
        target: ts.ScriptTarget.ES2020
    };
    const directories = sourceDirectories(sources);
    const normalizeInternal = (fileName: string): string => {
        const value = fileName.split('\\').join('/');
        return path.normalize(value.startsWith('/') ? value : path.join(VIRTUAL_ROOT, value));
    };
    const resolutionHost: ts.ModuleResolutionHost = {
        directoryExists: directory => directories.has(normalizeInternal(directory)),
        fileExists: fileName => sourceByInternal.has(normalizeInternal(fileName)),
        getCurrentDirectory: () => VIRTUAL_ROOT,
        readFile: fileName => sourceByInternal.get(normalizeInternal(fileName))?.text,
        realpath: fileName => normalizeInternal(fileName)
    };
    const host: ts.CompilerHost = {
        fileExists: resolutionHost.fileExists,
        getCanonicalFileName: fileName => fileName,
        getCurrentDirectory: () => VIRTUAL_ROOT,
        getDefaultLibFileName: () => '',
        getNewLine: () => '\n',
        getSourceFile: (fileName, languageVersion) => {
            const source = sourceByInternal.get(normalizeInternal(fileName));
            if (!source || !source.supported) return undefined;
            const sourceFile = ts.createSourceFile(
                source.internal,
                source.text,
                languageVersion,
                true,
                scriptKindFromFileName(source.logical)
            );
            source.sourceFile = sourceFile;
            return sourceFile;
        },
        readFile: resolutionHost.readFile,
        useCaseSensitiveFileNames: () => true,
        writeFile: () => { }
    };
    host.directoryExists = resolutionHost.directoryExists;
    host.realpath = resolutionHost.realpath;
    host.resolveModuleNames = (moduleNames, containingFile) => moduleNames.map(moduleName =>
        ts.resolveModuleName(moduleName, containingFile, compilerOptions, resolutionHost).resolvedModule
    );

    let program: ts.Program | undefined;
    let checker: ts.TypeChecker | undefined;
    try {
        program = ts.createProgram(
            sources.filter(source => source.supported).map(source => source.internal),
            compilerOptions,
            host
        );
        checker = program.getTypeChecker();
    } catch (error: unknown) {
        const message = `TypeScript program creation failed: ${errorMessage(error)}`;
        for (const context of contexts.values()) {
            context.output.status = 'invalid';
            addDiagnostic(context, 'program-failed', message);
        }
        return finish(sources, contexts);
    }

    const sourceFileByInternal = new Map<string, ts.SourceFile>();
    for (const source of sources) {
        if (!source.supported) {
            contexts.get(source.internal)!.output.status = 'invalid';
            addDiagnostic(contexts.get(source.internal)!, 'unsupported-file-type', 'Only JavaScript and TypeScript source files are analyzed.');
            continue;
        }
        const sourceFile = source.sourceFile ?? program.getSourceFile(source.internal);
        if (!sourceFile) {
            const context = contexts.get(source.internal)!;
            context.output.status = 'invalid';
            addDiagnostic(context, 'source-unavailable', 'The compiler host could not create a source file from the supplied text.');
            continue;
        }
        source.sourceFile = sourceFile;
        sourceFileByInternal.set(source.internal, sourceFile);
    }

    for (const source of sources) {
        const context = contexts.get(source.internal)!;
        if (!source.sourceFile) continue;
        collectNodes(context, source.sourceFile);
    }

    for (const source of sources) {
        const context = contexts.get(source.internal)!;
        if (!source.sourceFile || !checker) continue;
        const visitor = new SourceVisitor(context, source.sourceFile, checker, sourceByInternal, sourceFileByInternal, compilerOptions, resolutionHost, contexts);
        visitor.visit(source.sourceFile, { owner: context.nodesById.get('<init>')!, phase: source.sourceFile.isDeclarationFile ? 'type' : 'module-init' });
        visitor.finish();
    }

    addCompilerScopeDiagnostics(program, contexts);
    return finish(sources, contexts);
}

function createSources(files: Record<string, string>): SourceInput[] {
    const sources: SourceInput[] = [];
    const seen = new Set<string>();
    for (const original of Object.keys(files).sort()) {
        const logical = normalizeLogicalFileName(original);
        if (!logical || seen.has(logical)) continue;
        seen.add(logical);
        const raw = files[original];
        sources.push({
            logical,
            internal: path.join(VIRTUAL_ROOT, logical),
            text: typeof raw === 'string' ? raw : '',
            supported: typeof raw === 'string' && isSupportedFileName(logical)
        });
    }
    return sources;
}

function createDocumentContext(source: SourceInput): DocumentContext {
    const init: TypescriptDependencyNode = {
        end: source.text.length,
        id: '<init>',
        kind: 'module-init',
        name: '<init>',
        start: 0
    };
    const output: TypescriptDependencyDocument = {
        diagnostics: [],
        nodes: [init],
        sites: [],
        status: 'complete'
    };
    const initRecord = { ...init, ast: undefined as unknown as ts.Node, source };
    return {
        diagnosticKeys: new Set(),
        nodeByAst: new Map(),
        nodesById: new Map([['<init>', initRecord]]),
        output,
        source,
        truncated: false
    };
}

function collectNodes(context: DocumentContext, sourceFile: ts.SourceFile): void {
    const collect = (node: ts.Node): void => {
        if (isRuntimeClass(node, sourceFile) || isRuntimeFunction(node, sourceFile)) {
            addNode(context, node, isRuntimeClass(node, sourceFile) ? 'class' : 'function');
        }
        node.forEachChild(collect);
    };
    sourceFile.forEachChild(collect);
    context.output.nodes.sort((left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id));
    // Keep module-init first even when a declaration starts at offset zero.
    const initIndex = context.output.nodes.findIndex(node => node.id === '<init>');
    if (initIndex > 0) context.output.nodes.unshift(...context.output.nodes.splice(initIndex, 1));
}

function addNode(context: DocumentContext, node: ts.Node, kind: 'function' | 'class'): NodeRecord | undefined {
    if (context.nodeByAst.has(node)) return context.nodeByAst.get(node);
    if (context.output.nodes.length >= MAX_NODES_PER_FILE + 1) {
        markTruncated(context, 'node-limit', 'Node traversal stopped after the per-file node limit was reached.');
        return undefined;
    }
    const sourceFile = context.source.sourceFile;
    if (!sourceFile) return undefined;
    const start = node.getStart(sourceFile);
    const name = declarationName(node, kind, sourceFile);
    const record: NodeRecord = {
        ast: node,
        end: node.end,
        id: `${name}@${start}`,
        kind,
        name,
        source: context.source,
        start
    };
    context.nodeByAst.set(node, record);
    context.nodesById.set(record.id, record);
    context.output.nodes.push({
        end: record.end,
        id: record.id,
        kind: record.kind,
        name: record.name,
        start: record.start
    });
    return record;
}

class SourceVisitor {
    constructor(
        private readonly context: DocumentContext,
        private readonly sourceFile: ts.SourceFile,
        private readonly checker: ts.TypeChecker,
        private readonly sourceByInternal: Map<string, SourceInput>,
        private readonly sourceFileByInternal: Map<string, ts.SourceFile>,
        private readonly compilerOptions: ts.CompilerOptions,
        private readonly resolutionHost: ts.ModuleResolutionHost,
        private readonly contexts: Map<string, DocumentContext>
    ) { }

    visit(node: ts.Node, context: VisitContext): void {
        if (this.context.truncated) return;
        if (isTypeSyntaxNode(node) && context.phase !== 'type') context = { ...context, phase: 'type' };

        if (ts.isImportDeclaration(node)) {
            this.visitImport(node, context);
            return;
        }
        if (ts.isExportDeclaration(node)) {
            this.visitExport(node, context);
            return;
        }
        if (ts.isExportAssignment(node)) {
            this.visitExportAssignment(node, context);
            return;
        }
        if (ts.isImportEqualsDeclaration(node)) {
            this.visitImportEquals(node, context);
            return;
        }
        if (ts.isImportTypeNode(node)) {
            this.visitImportType(node, context);
            return;
        }
        if (ts.isTypeReferenceNode(node)) {
            this.visitTypeReference(node, context);
            return;
        }
        if (ts.isTypeQueryNode(node)) {
            this.visitTypeQuery(node, context);
            return;
        }
        if (isRuntimeClass(node, this.sourceFile)) {
            this.visitClass(node as RuntimeClass, context);
            return;
        }
        if (isRuntimeFunction(node, this.sourceFile)) {
            this.visitFunction(node as RuntimeDeclaration, context);
            return;
        }
        if (ts.isMethodSignature(node) || ts.isCallSignatureDeclaration(node) || ts.isConstructSignatureDeclaration(node) ||
            ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node) || ts.isIndexSignatureDeclaration(node)) {
            this.visitTypeDeclaration(node, context);
            return;
        }
        if (ts.isVariableDeclaration(node)) {
            this.visitVariableDeclaration(node, context);
            return;
        }
        if (ts.isBindingElement(node)) {
            this.visitBindingElement(node, context);
            return;
        }
        if (ts.isParameter(node)) {
            this.visitParameter(node, context.owner, context.phase);
            return;
        }
        if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
            this.visitProperty(node, context);
            return;
        }
        if (ts.isClassStaticBlockDeclaration(node)) {
            this.visitStaticBlock(node, context);
            return;
        }
        if (ts.isCallExpression(node)) {
            this.visitCall(node, context);
            return;
        }
        if (ts.isNewExpression(node)) {
            this.visitNew(node, context);
            return;
        }
        if (ts.isIdentifier(node)) {
            if (!context.skipReference && !isDeclarationName(node)) {
                this.addReference(node, node.text, context);
            }
            return;
        }
        if (ts.isTypeParameterDeclaration(node)) {
            node.forEachChild(child => this.visit(child, { ...context, phase: 'type' }));
            return;
        }
        if (ts.isHeritageClause(node)) {
            this.visitHeritageClause(node, context);
            return;
        }
        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
            node.forEachChild(child => this.visit(child, context));
            return;
        }
        if (ts.isDecorator(node)) {
            this.visit(node.expression, context);
            return;
        }
        node.forEachChild(child => this.visit(child, context));
    }

    finish(): void {
        const syntaxDiagnostics = (this.sourceFile as ts.SourceFile & {
            parseDiagnostics?: readonly ts.Diagnostic[];
        }).parseDiagnostics ?? [];
        for (const diagnostic of syntaxDiagnostics) {
            this.context.output.status = 'invalid';
            addDiagnostic(this.context, `ts-${diagnostic.code}`, ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
        }
        for (const site of this.context.output.sites) {
            if (site.relation !== 'import' && site.relation !== 'reexport') continue;
            if (site.resolution === 'unresolved') {
                addDiagnostic(this.context, 'module-unresolved', site.reason ?? `Module ${site.specifier ?? '(computed)'} was not found in the supplied sources.`);
            } else if (site.resolution === 'external') {
                addDiagnostic(this.context, 'external-module', site.reason ?? `External module ${site.specifier ?? '(unknown)'} was not loaded.`);
            } else if (site.resolution === 'unsupported') {
                addDiagnostic(this.context, 'module-unsupported', site.reason ?? 'The module specifier is not statically supported.');
            }
        }
    }

    private visitImport(node: ts.ImportDeclaration, context: VisitContext): void {
        const specifier = literalText(node.moduleSpecifier);
        const clause = node.importClause;
        const namedBindings = clause?.namedBindings;
        const allNamedImportsAreTypeOnly = Boolean(
            !clause?.name && namedBindings && ts.isNamedImports(namedBindings) && namedBindings.elements.length > 0 &&
            namedBindings.elements.every(element => element.isTypeOnly)
        );
        const typeOnly = Boolean(clause?.isTypeOnly || allNamedImportsAreTypeOnly);
        const deferred = Boolean((clause as ts.ImportClause & { phaseModifier?: ts.SyntaxKind } | undefined)?.phaseModifier === ts.SyntaxKind.DeferKeyword);
        const phase: SitePhase = typeOnly ? 'type' : deferred ? 'unknown' : 'module-init';
        this.addModuleSite(node, 'import', specifier, phase, deferred ? 'deferred' : 'eager', context);
    }

    private visitExport(node: ts.ExportDeclaration, context: VisitContext): void {
        const specifier = literalText(node.moduleSpecifier);
        const exportClause = node.exportClause;
        const elements = exportClause && ts.isNamedExports(exportClause) ? exportClause.elements : undefined;
        const allNamedExportsAreTypeOnly = Boolean(
            elements && elements.length > 0 && elements.every(element => element.isTypeOnly)
        );
        const typeOnly = Boolean(node.isTypeOnly || allNamedExportsAreTypeOnly);
        const phase: SitePhase = typeOnly ? 'type' : 'module-init';
        if (elements && elements.length > 0) {
            for (const element of elements) {
                const name = element.name.getText(this.sourceFile);
                const siteNode = element.name;
                const resolution = specifier === undefined
                    ? this.resolveSymbol(this.checker.getSymbolAtLocation(element.propertyName ?? element.name), 'reference')
                    : this.resolveModule(specifier);
                this.addSite(siteNode, context.owner, {
                    name,
                    phase,
                    relation: 'reexport',
                    resolution,
                    specifier
                });
            }
            return;
        }
        if (specifier !== undefined) {
            this.addModuleSite(node, 'reexport', specifier, phase, 'eager', context, '*');
        }
    }

    private visitExportAssignment(node: ts.ExportAssignment, context: VisitContext): void {
        this.visit(node.expression, context);
    }

    private visitImportEquals(node: ts.ImportEqualsDeclaration, context: VisitContext): void {
        if (!ts.isExternalModuleReference(node.moduleReference)) return;
        const specifier = literalText(node.moduleReference.expression);
        this.addModuleSite(node, 'import', specifier, node.isTypeOnly ? 'type' : 'module-init', 'eager', context, node.name.text);
    }

    private visitImportType(node: ts.ImportTypeNode, context: VisitContext): void {
        const specifier = ts.isLiteralTypeNode(node.argument) ? literalText(node.argument.literal) : undefined;
        this.addModuleSite(node, 'import', specifier, 'type', 'deferred', context, specifier ?? 'import');
    }

    private visitTypeReference(node: ts.TypeReferenceNode, context: VisitContext): void {
        const name = node.typeName.getText(this.sourceFile);
        this.addReference(node.typeName, name, { ...context, phase: 'type' });
        node.typeArguments?.forEach(argument => this.visit(argument, { ...context, phase: 'type' }));
    }

    private visitTypeQuery(node: ts.TypeQueryNode, context: VisitContext): void {
        this.addReference(node.exprName, node.exprName.getText(this.sourceFile), { ...context, phase: 'type' });
        node.typeArguments?.forEach(argument => this.visit(argument, { ...context, phase: 'type' }));
    }

    private visitClass(node: RuntimeClass, enclosing: VisitContext): void {
        const record = this.context.nodeByAst.get(node) ?? addNode(this.context, node, 'class');
        if (!record) return;
        node.forEachChild(child => {
            if (child === node.name) {
                if (node.name && ts.isComputedPropertyName(node.name)) this.visit(node.name, { owner: record, phase: enclosing.phase });
            } else if (ts.isDecorator(child)) {
                this.visit(child, { owner: record, phase: enclosing.phase });
            } else if (ts.isHeritageClause(child)) {
                this.visitHeritageClause(child, { owner: record, phase: enclosing.phase });
            } else if (ts.isMethodDeclaration(child) || ts.isGetAccessorDeclaration(child) || ts.isSetAccessorDeclaration(child) || ts.isConstructorDeclaration(child)) {
                this.visitFunction(child, { owner: record, phase: enclosing.phase });
            } else if (ts.isPropertyDeclaration(child)) {
                this.visitProperty(child, { owner: record, phase: enclosing.phase });
            } else if (ts.isClassStaticBlockDeclaration(child)) {
                this.visitStaticBlock(child, { owner: record, phase: enclosing.phase });
            } else {
                this.visit(child, { owner: record, phase: enclosing.phase });
            }
        });
    }

    private visitFunction(node: RuntimeDeclaration, enclosing: VisitContext): void {
        const record = this.context.nodeByAst.get(node) ?? addNode(this.context, node, 'function');
        if (!record) return;
        const named = node as ts.NamedDeclaration;
        node.forEachChild(child => {
            if (child === named.name) {
                if (named.name && ts.isComputedPropertyName(named.name)) this.visit(named.name, { owner: record, phase: enclosing.phase });
            } else if (ts.isDecorator(child)) {
                this.visit(child, { owner: record, phase: enclosing.phase });
            } else if (ts.isParameter(child)) {
                this.visitParameter(child, record, enclosing.phase);
            } else if (node.body && child === node.body) {
                this.visit(child, { owner: record, phase: 'invocation' });
            } else {
                this.visit(child, { owner: record, phase: isTypeSyntaxNode(child) ? 'type' : enclosing.phase });
            }
        });
    }

    private visitParameter(node: ts.ParameterDeclaration, owner: NodeRecord, enclosingPhase: SitePhase): void {
        node.forEachChild(child => {
            if (child === node.name) {
                if (ts.isObjectBindingPattern(child) || ts.isArrayBindingPattern(child)) this.visitBindingPattern(child, owner, 'invocation');
            } else if (ts.isDecorator(child)) {
                this.visit(child, { owner, phase: enclosingPhase });
            } else if (node.type && child === node.type) {
                this.visit(child, { owner, phase: 'type' });
            } else if (node.initializer && child === node.initializer) {
                this.visit(child, { owner, phase: 'invocation' });
            } else {
                this.visit(child, { owner, phase: 'invocation' });
            }
        });
    }

    private visitBindingPattern(node: ts.BindingPattern, owner: NodeRecord, phase: SitePhase): void {
        node.forEachChild(child => {
            if (ts.isBindingElement(child)) this.visitBindingElement(child, { owner, phase });
            else this.visit(child, { owner, phase });
        });
    }

    private visitBindingElement(node: ts.BindingElement, context: VisitContext): void {
        if (node.propertyName && ts.isComputedPropertyName(node.propertyName)) this.visit(node.propertyName, context);
        if (node.initializer) this.visit(node.initializer, context);
    }

    private visitVariableDeclaration(node: ts.VariableDeclaration, context: VisitContext): void {
        if (node.type) this.visit(node.type, { ...context, phase: 'type' });
        if (node.initializer) this.visit(node.initializer, context);
    }

    private visitProperty(node: ts.PropertyDeclaration | ts.PropertySignature, context: VisitContext): void {
        if (ts.isPropertyDeclaration(node)) {
            for (const decorator of ts.getDecorators(node) ?? []) {
                this.visit(decorator, { owner: context.owner, phase: context.phase });
            }
        }
        if (node.name && ts.isComputedPropertyName(node.name)) this.visit(node.name, { owner: context.owner, phase: context.phase });
        if (node.type) this.visit(node.type, { owner: context.owner, phase: 'type' });
        if (!('initializer' in node) || !node.initializer) return;
        const isStatic = ts.isPropertyDeclaration(node) && (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Static) !== 0;
        this.visit(node.initializer, { owner: context.owner, phase: isStatic ? context.phase : 'unknown' });
    }

    private visitStaticBlock(node: ts.ClassStaticBlockDeclaration, context: VisitContext): void {
        node.forEachChild(child => this.visit(child, context));
    }

    private visitTypeDeclaration(node: ts.Node, context: VisitContext): void {
        node.forEachChild(child => this.visit(child, { ...context, phase: 'type' }));
    }

    private visitHeritageClause(node: ts.HeritageClause, context: VisitContext): void {
        const isExtends = node.token === ts.SyntaxKind.ExtendsKeyword;
        for (const type of node.types) {
            if (isExtends) {
                this.visit(type.expression, context);
                type.typeArguments?.forEach(argument => this.visit(argument, { ...context, phase: 'type' }));
            } else {
                this.visit(type, { ...context, phase: 'type' });
            }
        }
    }

    private visitCall(node: ts.CallExpression, context: VisitContext): void {
        if (isDynamicImport(node)) {
            const specifier = literalText(node.arguments[0]);
            this.addModuleSite(node, 'import', specifier, context.phase, 'deferred', context, specifier ?? 'import');
            for (const argument of node.arguments) {
                if (literalText(argument) === undefined) this.visit(argument, context);
            }
            return;
        }
        if (isRequireCall(node)) {
            const specifier = literalText(node.arguments[0]);
            const binding = this.checker.getSymbolAtLocation(node.expression);
            const shadowed = Boolean(binding?.declarations?.some(declaration => declaration.getSourceFile() === this.sourceFile));
            const resolution = shadowed
                ? { resolution: 'ambiguous' as const, reason: 'require() may be shadowed by a local binding.' }
                : this.resolveModule(specifier);
            this.addSite(node, context.owner, {
                name: 'require',
                phase: context.phase,
                relation: 'import',
                resolution,
                specifier,
                loading: 'eager'
            });
            node.arguments.forEach(argument => {
                if (literalText(argument) === undefined) this.visit(argument, context);
            });
            return;
        }
        this.addSite(node, context.owner, {
            name: expressionName(node.expression, this.sourceFile),
            phase: context.phase,
            relation: 'call',
            resolution: this.resolveCall(node)
        });
        this.visitCallee(node.expression, context);
        node.arguments.forEach(argument => this.visit(argument, context));
    }

    private visitNew(node: ts.NewExpression, context: VisitContext): void {
        this.addSite(node, context.owner, {
            name: expressionName(node.expression, this.sourceFile),
            phase: context.phase,
            relation: 'construct',
            resolution: this.resolveConstruct(node)
        });
        this.visitCallee(node.expression, context);
        node.arguments?.forEach(argument => this.visit(argument, context));
    }

    private visitCallee(node: ts.Expression, context: VisitContext): void {
        const nestedContext = { ...context, skipReference: true };
        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
            this.visit(node.expression, nestedContext);
            if (ts.isElementAccessExpression(node) && node.argumentExpression) this.visit(node.argumentExpression, context);
            return;
        }
        this.visit(node, nestedContext);
    }

    private addModuleSite(
        node: ts.Node,
        relation: 'import' | 'reexport',
        specifier: string | undefined,
        phase: SitePhase,
        loading: 'eager' | 'deferred',
        context: VisitContext,
        name = specifier ?? '(computed)'
    ): void {
        this.addSite(node, context.owner, {
            name,
            phase,
            relation,
            resolution: this.resolveModule(specifier),
            specifier,
            loading
        });
    }

    private addReference(node: ts.Node, name: string, context: VisitContext): void {
        const resolution = context.phase !== 'type' && isTypeOnlyValueUse(node, this.checker)
            ? { reason: 'A type-only import has no runtime binding.', resolution: 'unresolved' as const }
            : this.resolveSymbol(this.checker.getSymbolAtLocation(node), 'reference');
        this.addSite(node, context.owner, {
            name,
            phase: context.phase,
            relation: 'reference',
            resolution
        });
    }

    private addSite(node: ts.Node, owner: NodeRecord, site: {
        name: string;
        phase: SitePhase;
        relation: TypescriptDependencyRelation;
        resolution: TargetResolution | ModuleResolution;
        specifier?: string;
        loading?: 'eager' | 'deferred';
    }): void {
        if (this.context.output.sites.length >= MAX_SITES_PER_FILE) {
            markTruncated(this.context, 'site-limit', 'Site traversal stopped after the per-file site limit was reached.');
            return;
        }
        const start = node.getStart(this.sourceFile);
        const outputSite: TypescriptDependencySite = {
            end: node.end,
            name: site.name,
            owner: owner.id,
            phase: this.sourceFile.isDeclarationFile ? 'type' : site.phase,
            relation: site.relation,
            resolution: site.resolution.resolution,
            start
        };
        if (site.specifier !== undefined) outputSite.specifier = site.specifier;
        if (site.loading !== undefined) outputSite.loading = site.loading;
        if (site.resolution.target) outputSite.target = site.resolution.target;
        if ('candidates' in site.resolution && site.resolution.candidates) outputSite.candidates = site.resolution.candidates;
        if (site.resolution.reason) outputSite.reason = site.resolution.reason;
        this.context.output.sites.push(outputSite);
    }

    private resolveModule(specifier: string | undefined): ModuleResolution {
        if (specifier === undefined) return { reason: 'The module specifier is not a string literal.', resolution: 'unsupported' };
        const resolved = ts.resolveModuleName(
            specifier,
            this.sourceFile.fileName,
            this.compilerOptions,
            this.resolutionHost
        ).resolvedModule;
        const target = resolved && this.sourceByInternal.get(normalizeInternalName(resolved.resolvedFileName));
        if (target) return { resolution: 'resolved', target: { file: target.logical } };
        if (isRelativeSpecifier(specifier)) {
            return { reason: `Relative module ${specifier} is not present in the supplied sources.`, resolution: 'unresolved' };
        }
        if (specifier.startsWith('/') || /^[A-Za-z]:[\\/]/.test(specifier)) {
            return { reason: 'Absolute module specifiers are outside the adapter scope.', resolution: 'unsupported' };
        }
        return { reason: `External module ${specifier} was not loaded because only supplied sources are available.`, resolution: 'external' };
    }

    private resolveCall(node: ts.CallExpression): TargetResolution {
        return this.resolveUse(node.expression, 'call');
    }

    private resolveConstruct(node: ts.NewExpression): TargetResolution {
        return this.resolveUse(node.expression, 'construct');
    }

    private resolveUse(expression: ts.Expression, use: 'call' | 'construct' | 'reference'): TargetResolution {
        const unwrapped = unwrapExpression(expression);
        if (isTypeOnlyValueUse(unwrapped, this.checker)) {
            return { reason: 'A type-only import has no runtime binding.', resolution: 'unresolved' };
        }
        const directRecord = this.context.nodeByAst.get(unwrapped);
        if (directRecord && ((use === 'construct' && directRecord.kind === 'class') || (use !== 'construct' && directRecord.kind === 'function'))) {
            return { resolution: 'resolved', target: targetForNode(directRecord) };
        }
        const symbol = this.checker.getSymbolAtLocation(symbolLocation(unwrapped));
        const result = this.symbolCandidates(symbol, use);
        if (result.candidates.length === 1) {
            const candidate = result.candidates[0];
            if (use !== 'construct' && isPotentiallyVirtualReceiver(unwrapped, candidate)) {
                return {
                    candidates: [targetForNode(candidate)],
                    reason: 'The checker found a receiver method, but runtime virtual dispatch is not proven.',
                    resolution: 'ambiguous'
                };
            }
            return { resolution: 'resolved', target: targetForNode(candidate) };
        }
        if (result.candidates.length > 1) {
            return {
                candidates: result.candidates.map(targetForNode),
                reason: 'Multiple declarations match this use.',
                resolution: 'ambiguous'
            };
        }
        if (result.externalSpecifier) {
            return {
                reason: `The declaration comes from external module ${result.externalSpecifier}, which was not supplied.`,
                resolution: 'external'
            };
        }
        if (result.signatureOnly) {
            return { reason: 'A function type or signature was found, but no runtime declaration was proven.', resolution: 'unresolved' };
        }
        if (ts.isElementAccessExpression(unwrapped)) {
            return { reason: 'Computed member dispatch is not resolved without whole-program dataflow.', resolution: 'unsupported' };
        }
        return { reason: 'No direct runtime declaration was identified.', resolution: 'unresolved' };
    }

    private resolveSymbol(symbol: ts.Symbol | undefined, use: 'reference' | 'call' | 'construct'): TargetResolution {
        const result = this.symbolCandidates(symbol, use);
        if (result.candidates.length === 1) return { resolution: 'resolved', target: targetForNode(result.candidates[0]) };
        if (result.candidates.length > 1) {
            return { candidates: result.candidates.map(targetForNode), reason: 'Multiple declarations match this reference.', resolution: 'ambiguous' };
        }
        if (result.externalSpecifier) {
            return { reason: `The declaration comes from external module ${result.externalSpecifier}, which was not supplied.`, resolution: 'external' };
        }
        if (result.signatureOnly) {
            return { reason: 'A type-only or signature declaration was found, but no runtime node was proven.', resolution: 'unresolved' };
        }
        return { reason: 'No supplied runtime declaration was identified.', resolution: 'unresolved' };
    }

    private symbolCandidates(symbol: ts.Symbol | undefined, use: 'reference' | 'call' | 'construct'): CandidateResult {
        if (!symbol) return { candidates: [], signatureOnly: false };
        const symbols: ts.Symbol[] = [symbol];
        const seenSymbols = new Set<ts.Symbol>();
        for (let index = 0; index < symbols.length; index++) {
            const current = symbols[index];
            if (seenSymbols.has(current)) continue;
            seenSymbols.add(current);
            if ((current.flags & ts.SymbolFlags.Alias) !== 0) {
                try {
                    const aliased = this.checker.getAliasedSymbol(current);
                    if (aliased && aliased !== current) symbols.push(aliased);
                } catch {
                    // An unresolved alias is handled below as external/unresolved.
                }
            }
        }
        const candidates: NodeRecord[] = [];
        let signatureOnly = false;
        let externalSpecifier: string | undefined;
        for (const current of symbols) {
            if (externalSpecifier === undefined) externalSpecifier = importedExternalSpecifier(current);
            for (const declaration of current.declarations ?? []) {
                const candidate = this.declarationTarget(declaration, use);
                if (candidate && !candidates.some(existing => existing.id === candidate.id && existing.source.internal === candidate.source.internal)) {
                    candidates.push(candidate);
                } else if (isSignatureOnlyDeclaration(declaration)) {
                    signatureOnly = true;
                }
            }
        }
        return { candidates, externalSpecifier, signatureOnly };
    }

    private declarationTarget(declaration: ts.Declaration, use: 'reference' | 'call' | 'construct'): NodeRecord | undefined {
        const source = this.sourceByInternal.get(normalizeInternalName(declaration.getSourceFile().fileName));
        if (!source) return undefined;
        const context = this.contexts.get(source.internal);
        if (!context) return undefined;
        if (use === 'construct' && ts.isConstructorDeclaration(declaration)) {
            const classNode = nearestRuntimeClass(declaration, context);
            return classNode ? context.nodeByAst.get(classNode) : undefined;
        }
        const direct = context.nodeByAst.get(declaration);
        if (direct && (use !== 'construct' || direct.kind === 'class')) return direct;
        if (ts.isVariableDeclaration(declaration) && declaration.initializer && isStableVariableInitializer(declaration, this.checker)) {
            const initializer = unwrapExpression(declaration.initializer);
            const record = context.nodeByAst.get(initializer);
            if (record && (use !== 'construct' || record.kind === 'class')) return record;
        }
        if (ts.isPropertyDeclaration(declaration) && declaration.initializer &&
            isStablePropertyInitializer(declaration, this.sourceFileByInternal.values())) {
            const initializer = unwrapExpression(declaration.initializer);
            const record = context.nodeByAst.get(initializer);
            if (record && (use !== 'construct' || record.kind === 'class')) return record;
        }
        return undefined;
    }
}

function addCompilerScopeDiagnostics(program: ts.Program, contexts: Map<string, DocumentContext>): void {
    const globalDiagnostics = program.getGlobalDiagnostics();
    const missingAmbient = globalDiagnostics.some(diagnostic => diagnostic.code === 2318 || diagnostic.code === 2688 || diagnostic.code === 6053);
    if (missingAmbient) {
        for (const context of contexts.values()) {
            if (context.source.supported) addDiagnostic(context, 'missing-ambient-input', 'Ambient libraries, tsconfig files, and node_modules were intentionally excluded from this source-only analysis.');
        }
    }
    for (const context of contexts.values()) {
        if (!context.source.sourceFile) continue;
        for (const diagnostic of program.getSemanticDiagnostics(context.source.sourceFile)) {
            if (diagnostic.code === 2307 || diagnostic.code === 2792) {
                addDiagnostic(context, 'compiler-module-resolution', ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
            } else if (diagnostic.code === 2688 || diagnostic.code === 6053) {
                addDiagnostic(context, 'compiler-missing-input', ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
            }
        }
    }
}

function finish(sources: SourceInput[], contexts: Map<string, DocumentContext>): TypescriptDependencyAnalysis {
    const documents: Record<string, TypescriptDependencyDocument> = {};
    for (const source of sources) documents[source.logical] = contexts.get(source.internal)!.output;
    return { documents, producer: PRODUCER };
}

function addDiagnostic(context: DocumentContext, code: string, message: string): void {
    const key = `${code}\0${message}`;
    if (context.diagnosticKeys.has(key) || context.output.diagnostics.length >= MAX_DIAGNOSTICS_PER_FILE) return;
    context.diagnosticKeys.add(key);
    context.output.diagnostics.push({ code, message });
}

function markTruncated(context: DocumentContext, code: string, message: string): void {
    context.truncated = true;
    context.output.status = 'invalid';
    addDiagnostic(context, code, message);
}

function addNodeName(node: ts.Node, sourceFile: ts.SourceFile): string {
    const named = node as ts.NamedDeclaration;
    if (named.name) return named.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
    const parent = node.parent;
    if (parent && ts.isVariableDeclaration(parent) && parent.initializer === node) return parent.name.getText(sourceFile);
    if (parent && ts.isPropertyAssignment(parent) && parent.initializer === node) return parent.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
    return '<anonymous>';
}

function declarationName(node: ts.Node, kind: 'function' | 'class', sourceFile: ts.SourceFile): string {
    if (ts.isConstructorDeclaration(node)) return 'constructor';
    return addNodeName(node, sourceFile) || (kind === 'class' ? 'class' : 'function');
}

function isRuntimeFunction(node: ts.Node, sourceFile: ts.SourceFile): node is RuntimeDeclaration {
    if (sourceFile.isDeclarationFile) return false;
    if (isInAmbientContext(node)) return false;
    if (!(ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isConstructorDeclaration(node))) return false;
    if (!('body' in node) || !node.body) return false;
    return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Ambient) === 0;
}

function isRuntimeClass(node: ts.Node, sourceFile: ts.SourceFile): node is RuntimeClass {
    if (sourceFile.isDeclarationFile || !(ts.isClassDeclaration(node) || ts.isClassExpression(node))) return false;
    if (isInAmbientContext(node)) return false;
    return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Ambient) === 0;
}

function isInAmbientContext(node: ts.Node): boolean {
    for (let current = node.parent; current; current = current.parent) {
        if (ts.isModuleDeclaration(current) && (ts.getCombinedModifierFlags(current) & ts.ModifierFlags.Ambient) !== 0) return true;
    }
    return false;
}

function isTypeSyntaxNode(node: ts.Node): boolean {
    return node.kind >= ts.SyntaxKind.FirstTypeNode && node.kind <= ts.SyntaxKind.LastTypeNode;
}

function isDeclarationName(node: ts.Identifier): boolean {
    const parent = node.parent;
    if (!parent) return false;
    if (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isTypeParameterDeclaration(parent) ||
        ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isImportClause(parent) ||
        ts.isNamespaceImport(parent) || ts.isImportEqualsDeclaration(parent) || ts.isInterfaceDeclaration(parent) ||
        ts.isTypeAliasDeclaration(parent) || ts.isEnumDeclaration(parent) || ts.isModuleDeclaration(parent) ||
        ts.isBindingElement(parent)) return parent.name === node;
    if (ts.isMethodDeclaration(parent) || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) ||
        ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) || ts.isMethodSignature(parent)) {
        return parent.name === node;
    }
    if (ts.isPropertyAssignment(parent)) return parent.name === node;
    if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return parent.name === node || parent.propertyName === node;
    if (ts.isLabeledStatement(parent) || ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) return parent.label === node;
    return false;
}

function isDynamicImport(node: ts.CallExpression): boolean {
    return node.expression.kind === ts.SyntaxKind.ImportKeyword;
}

function isRequireCall(node: ts.CallExpression): boolean {
    return ts.isIdentifier(node.expression) && node.expression.text === 'require';
}

function literalText(node: ts.Node | undefined): string | undefined {
    if (!node) return undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    return undefined;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
    let current = expression;
    while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) ||
        ts.isNonNullExpression(current) || ts.isSatisfiesExpression(current)) current = current.expression;
    return current;
}

function symbolLocation(expression: ts.Expression): ts.Node {
    if (ts.isPropertyAccessExpression(expression)) return expression.name;
    if (ts.isElementAccessExpression(expression)) return expression.argumentExpression ?? expression;
    return expression;
}

function expressionName(expression: ts.Expression, sourceFile: ts.SourceFile): string {
    const unwrapped = unwrapExpression(expression);
    if (ts.isIdentifier(unwrapped)) return unwrapped.text;
    if (ts.isPropertyAccessExpression(unwrapped)) return unwrapped.name.text;
    if (ts.isElementAccessExpression(unwrapped)) return '<computed>';
    const text = unwrapped.getText(sourceFile).replace(/\s+/g, ' ').trim();
    return text.length > 120 ? `${text.slice(0, 117)}...` : text || '<expression>';
}

function isSignatureOnlyDeclaration(declaration: ts.Declaration): boolean {
    return ts.isMethodSignature(declaration) || ts.isCallSignatureDeclaration(declaration) || ts.isConstructSignatureDeclaration(declaration) ||
        ts.isFunctionTypeNode(declaration) || ts.isConstructorTypeNode(declaration) || ts.isInterfaceDeclaration(declaration) ||
        ts.isTypeAliasDeclaration(declaration) || ts.isIndexSignatureDeclaration(declaration) ||
        (ts.isFunctionDeclaration(declaration) && !declaration.body);
}

function nearestRuntimeClass(node: ts.Node, context: DocumentContext): RuntimeClass | undefined {
    for (let parent = node.parent; parent; parent = parent.parent) {
        if (isRuntimeClass(parent, context.source.sourceFile!)) return parent;
    }
    return undefined;
}

function isPotentiallyVirtualReceiver(expression: ts.Expression, candidate: NodeRecord): boolean {
    const declaration = candidate.ast;
    if (!(ts.isMethodDeclaration(declaration) || ts.isGetAccessorDeclaration(declaration) || ts.isSetAccessorDeclaration(declaration))) return false;
    if (!ts.isClassLike(declaration.parent)) return false;
    if ((ts.getCombinedModifierFlags(declaration) & (ts.ModifierFlags.Static | ts.ModifierFlags.Private)) !== 0) return false;
    const receiver = ts.isPropertyAccessExpression(expression) ? expression.expression : undefined;
    if (!receiver) return true;
    const unwrapped = unwrapExpression(receiver);
    return !(ts.isNewExpression(unwrapped) || unwrapped.kind === ts.SyntaxKind.SuperKeyword);
}

function importedExternalSpecifier(symbol: ts.Symbol): string | undefined {
    for (const declaration of symbol.declarations ?? []) {
        const importDeclaration = findImportDeclaration(declaration);
        const specifier = importDeclaration && literalText(importDeclaration.moduleSpecifier);
        if (specifier && !isRelativeSpecifier(specifier)) return specifier;
        if (ts.isImportEqualsDeclaration(declaration) && ts.isExternalModuleReference(declaration.moduleReference)) {
            const equalsSpecifier = literalText(declaration.moduleReference.expression);
            if (equalsSpecifier && !isRelativeSpecifier(equalsSpecifier)) return equalsSpecifier;
        }
    }
    return undefined;
}

function isTypeOnlyValueUse(node: ts.Node, checker: ts.TypeChecker): boolean {
    let current = node;
    for (;;) {
        if (ts.isIdentifier(current) && isTypeOnlyImportSymbol(checker.getSymbolAtLocation(current))) return true;
        if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
            current = current.expression;
            continue;
        }
        if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) ||
            ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current) ||
            ts.isSatisfiesExpression(current)) {
            current = current.expression;
            continue;
        }
        const parent = current.parent;
        if (ts.isPropertyAccessExpression(parent) && parent.name === current) {
            current = parent.expression;
            continue;
        }
        if (ts.isElementAccessExpression(parent) && parent.argumentExpression === current) {
            current = parent.expression;
            continue;
        }
        break;
    }
    return false;
}

function isTypeOnlyImportSymbol(symbol: ts.Symbol | undefined): boolean {
    return Boolean(symbol?.declarations?.some(declaration => {
        if (ts.isImportEqualsDeclaration(declaration)) return declaration.isTypeOnly;
        if (ts.isImportSpecifier(declaration) && declaration.isTypeOnly) return true;
        for (let current: ts.Node | undefined = declaration; current; current = current.parent) {
            if (ts.isImportClause(current)) return current.isTypeOnly;
            if (ts.isImportDeclaration(current)) return Boolean(current.importClause?.isTypeOnly);
            if (ts.isSourceFile(current)) break;
        }
        return false;
    }));
}

function findImportDeclaration(node: ts.Node): ts.ImportDeclaration | ts.ExportDeclaration | undefined {
    for (let current: ts.Node | undefined = node; current; current = current.parent) {
        if (ts.isImportDeclaration(current) || ts.isExportDeclaration(current)) return current;
    }
    return undefined;
}

function isRelativeSpecifier(specifier: string): boolean {
    return specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../');
}

function isStableVariableInitializer(declaration: ts.VariableDeclaration, checker: ts.TypeChecker): boolean {
    const declarationList = declaration.parent;
    if (ts.isVariableDeclarationList(declarationList) && (declarationList.flags & ts.NodeFlags.Const) !== 0) return true;
    const symbol = checker.getSymbolAtLocation(declaration.name);
    if (!symbol || !ts.isIdentifier(declaration.name)) return false;
    let mutated = false;
    const visit = (node: ts.Node): void => {
        if (mutated) return;
        const nodeSymbol = ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent)
            ? checker.getShorthandAssignmentValueSymbol(node.parent)
            : ts.isIdentifier(node) ? checker.getSymbolAtLocation(node) : undefined;
        if (ts.isIdentifier(node) && node !== declaration.name && nodeSymbol === symbol && isWriteReference(node)) {
            mutated = true;
            return;
        }
        node.forEachChild(visit);
    };
    declaration.getSourceFile().forEachChild(visit);
    return !mutated;
}

function isStablePropertyInitializer(
    declaration: ts.PropertyDeclaration,
    sourceFiles: Iterable<ts.SourceFile>
): boolean {
    if (ts.isComputedPropertyName(declaration.name)) return false;
    let mutated = false;
    const visit = (node: ts.Node): void => {
        if (mutated) return;
        if (node !== declaration.name && isPropertyWriteReference(node, declaration)) {
            mutated = true;
            return;
        }
        node.forEachChild(visit);
    };
    for (const sourceFile of sourceFiles) {
        sourceFile.forEachChild(visit);
        if (mutated) break;
    }
    return !mutated;
}

function isPropertyWriteReference(
    node: ts.Node,
    declaration: ts.PropertyDeclaration
): boolean {
    if (!ts.isIdentifier(node) || node === declaration.name) return false;
    if (node.text !== declaration.name.getText()) return false;
    const parent = node.parent;
    const access = ts.isPropertyAccessExpression(parent) && parent.name === node ? parent : undefined;
    if (!access) return false;
    const use = access.parent;
    if (ts.isBinaryExpression(use) && use.left === access && isAssignmentOperatorKind(use.operatorToken.kind)) return true;
    if (ts.isPrefixUnaryExpression(use) && use.operand === access &&
        (use.operator === ts.SyntaxKind.PlusPlusToken || use.operator === ts.SyntaxKind.MinusMinusToken)) return true;
    if (ts.isPostfixUnaryExpression(use) && use.operand === access) return true;
    if ((ts.isForInStatement(use) || ts.isForOfStatement(use)) && use.initializer === access) return true;
    if (ts.isDeleteExpression(use) && use.expression === access) return true;
    return isDestructuringAssignmentTarget(access);
}

function isWriteReference(node: ts.Identifier): boolean {
    const parent = node.parent;
    if (ts.isBinaryExpression(parent) && parent.left === node && isAssignmentOperatorKind(parent.operatorToken.kind)) return true;
    if (ts.isPrefixUnaryExpression(parent) && parent.operand === node &&
        (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)) return true;
    if (ts.isPostfixUnaryExpression(parent) && parent.operand === node) return true;
    if (ts.isForInStatement(parent) || ts.isForOfStatement(parent)) return parent.initializer === node;
    return isDestructuringAssignmentTarget(node);
}

function isDestructuringAssignmentTarget(node: ts.Node): boolean {
    let current = node;
    for (let parent = node.parent; parent; parent = parent.parent) {
        if (ts.isBinaryExpression(parent) && isAssignmentOperatorKind(parent.operatorToken.kind)) return parent.left === current;
        if ((ts.isForInStatement(parent) || ts.isForOfStatement(parent)) && parent.initializer === current) return true;
        if (ts.isParenthesizedExpression(parent) && parent.expression === current) {
            current = parent;
            continue;
        }
        if (ts.isArrayLiteralExpression(parent) && parent.elements.some(element => element === current)) {
            current = parent;
            continue;
        }
        if (ts.isObjectLiteralExpression(parent) && parent.properties.some(property => property === current)) {
            current = parent;
            continue;
        }
        if (ts.isShorthandPropertyAssignment(parent) && parent.name === current) {
            current = parent;
            continue;
        }
        if (ts.isPropertyAssignment(parent) && parent.initializer === current) {
            current = parent;
            continue;
        }
        return false;
    }
    return false;
}

function isAssignmentOperatorKind(kind: ts.SyntaxKind): boolean {
    return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function normalizeLogicalFileName(file: string): string {
    let value = file.split('\\').join('/');
    if (/^[A-Za-z]:\//.test(value)) value = value.slice(3);
    value = value.replace(/^\/+/, '');
    value = path.normalize(value);
    while (value.startsWith('../')) value = value.slice(3);
    return value === '.' ? '' : value;
}

function normalizeInternalName(file: string): string {
    const value = file.split('\\').join('/');
    return path.normalize(value.startsWith('/') ? value : path.join(VIRTUAL_ROOT, value));
}

function sourceDirectories(sources: SourceInput[]): Set<string> {
    const directories = new Set<string>([path.normalize(VIRTUAL_ROOT)]);
    for (const source of sources) {
        for (let directory = path.dirname(source.internal); directory.startsWith(path.normalize(VIRTUAL_ROOT)); directory = path.dirname(directory)) {
            directories.add(directory);
            if (directory === path.normalize(VIRTUAL_ROOT)) break;
        }
    }
    return directories;
}

function isSupportedFileName(file: string): boolean {
    return /\.(?:[cm]?[jt]sx?)$/i.test(file);
}

function scriptKindFromFileName(file: string): ts.ScriptKind {
    const lower = file.toLocaleLowerCase();
    if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
    if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
    if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')) return ts.ScriptKind.TS;
    if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return ts.ScriptKind.JS;
    return ts.ScriptKind.Unknown;
}

function targetForNode(node: NodeRecord): TypescriptDependencyTarget {
    return { file: node.source.logical, node: node.id };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
