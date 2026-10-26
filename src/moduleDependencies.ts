import * as ts from 'typescript';

export type ModuleDependencyRelationship = 'import' | 'reexport' | 'require' | 'dynamic-import';
export type ModuleDependencyPhase = 'type' | 'module-init' | 'invocation' | 'unknown';
export type ModuleDependencyLoading = 'eager' | 'deferred';

export interface ModuleDependencySite {
    specifier?: string;
    relationship: ModuleDependencyRelationship;
    phase: ModuleDependencyPhase;
    loading: ModuleDependencyLoading;
    start: number;
    end: number;
    line: number;
    column: number;
}

export interface ModuleInitializationSite {
    kind: 'call' | 'construct';
    phase: 'module-init';
    start: number;
    end: number;
    line: number;
    column: number;
}

export interface ModuleDependencyDiagnostic {
    code: string;
    message: string;
    start?: number;
    end?: number;
}

type RuntimePhase = 'module-init' | 'invocation' | 'unknown';
type FunctionLikeNode = ts.FunctionLikeDeclaration;

const MAX_TRAVERSAL_DEPTH = 2048;

class TraversalDepthLimitError extends Error {
    constructor() {
        super('AST traversal depth limit exceeded.');
        this.name = 'TraversalDepthLimitError';
    }
}

/**
 * Extracts syntactic module dependencies and possible module-initialization
 * effects. The caller is responsible for bounding the supplied source before
 * invoking this parser.
 */
export function extractModuleDependencies(file: string, content: string): {
    edges: ModuleDependencySite[];
    effects: ModuleInitializationSite[];
    diagnostics: ModuleDependencyDiagnostic[];
} {
    const edges: ModuleDependencySite[] = [];
    const effects: ModuleInitializationSite[] = [];
    const diagnostics: ModuleDependencyDiagnostic[] = [];

    let sourceFile: ts.SourceFile;
    try {
        sourceFile = ts.createSourceFile(
            file,
            content,
            ts.ScriptTarget.Latest,
            true,
            scriptKindFromFileName(file)
        );
    } catch (error: unknown) {
        diagnostics.push({ code: 'parser-failed', message: errorMessage(error) });
        return { edges, effects, diagnostics };
    }

    const parseDiagnostics = (sourceFile as ts.SourceFile & {
        parseDiagnostics?: readonly ts.Diagnostic[];
    }).parseDiagnostics ?? [];
    for (const diagnostic of parseDiagnostics) {
        const entry: ModuleDependencyDiagnostic = {
            code: `ts-${diagnostic.code}`,
            message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        };
        if (typeof diagnostic.start === 'number') {
            entry.start = diagnostic.start;
            entry.end = diagnostic.start + (diagnostic.length ?? 0);
        }
        diagnostics.push(entry);
    }

    const location = (node: ts.Node): { start: number; end: number; line: number; column: number } => {
        const start = node.getStart(sourceFile);
        const position = ts.getLineAndCharacterOfPosition(sourceFile, start);
        return { start, end: node.end, line: position.line + 1, column: position.character + 1 };
    };

    const addDiagnostic = (code: string, message: string, node?: ts.Node): void => {
        if (node) {
            const span = location(node);
            diagnostics.push({ code, message, start: span.start, end: span.end });
        } else {
            diagnostics.push({ code, message });
        }
    };

    const addEdge = (
        node: ts.Node,
        relationship: ModuleDependencyRelationship,
        phase: ModuleDependencyPhase,
        loading: ModuleDependencyLoading,
        specifier: string | undefined
    ): void => {
        edges.push({ specifier, relationship, phase: sourceFile.isDeclarationFile ? 'type' : phase, loading, ...location(node) });
    };

    const addEffect = (node: ts.Node, kind: 'call' | 'construct', phase: RuntimePhase): void => {
        if (sourceFile.isDeclarationFile || phase !== 'module-init') return;
        effects.push({ kind, phase, ...location(node) });
    };

    const literalSpecifier = (node: ts.Node | undefined): string | undefined => {
        if (!node) return undefined;
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
        return undefined;
    };

    const importTypeSpecifier = (node: ts.ImportTypeNode): string | undefined => {
        const argument = node.argument;
        if (!ts.isLiteralTypeNode(argument)) return undefined;
        return literalSpecifier(argument.literal);
    };

    const isRequireCall = (node: ts.CallExpression): boolean =>
        ts.isIdentifier(node.expression) && node.expression.text === 'require';

    const isDynamicImportCall = (node: ts.CallExpression): boolean =>
        node.expression.kind === ts.SyntaxKind.ImportKeyword;

    const isStaticProperty = (node: ts.PropertyDeclaration): boolean =>
        (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Static) !== 0;

    const isTransparentExpression = (node: ts.Node): node is ts.Expression & {
        expression: ts.Expression;
    } =>
        ts.isParenthesizedExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isTypeAssertionExpression(node) ||
        ts.isNonNullExpression(node) ||
        ts.isSatisfiesExpression(node);

    const unwrapExpression = (expression: ts.Expression): ts.Expression => {
        let current = expression;
        while (isTransparentExpression(current)) current = current.expression;
        return current;
    };

    const isIifeFunction = (node: ts.FunctionExpression | ts.ArrowFunction): boolean => {
        let parent: ts.Node | undefined = node.parent;
        while (parent && isTransparentExpression(parent)) parent = parent.parent;
        return Boolean(
            parent &&
            ts.isCallExpression(parent) &&
            unwrapExpression(parent.expression) === node
        );
    };

    const isRuntimeMethod = (
        node: ts.Node
    ): node is ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration | ts.ConstructorDeclaration =>
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node) ||
        ts.isConstructorDeclaration(node);

    const visit = (node: ts.Node, phase: RuntimePhase, depth: number): void => {
        if (depth > MAX_TRAVERSAL_DEPTH) throw new TraversalDepthLimitError();

        if (ts.isImportDeclaration(node)) {
            const clause = node.importClause;
            const namedBindings = clause?.namedBindings;
            const allNamedImportsAreTypeOnly =
                Boolean(!clause?.name && namedBindings && ts.isNamedImports(namedBindings) && namedBindings.elements.length > 0
                    && namedBindings.elements.every(element => element.isTypeOnly));
            const typeOnly = Boolean(clause?.isTypeOnly || allNamedImportsAreTypeOnly);
            addEdge(node, 'import', typeOnly ? 'type' : 'module-init', 'eager', literalSpecifier(node.moduleSpecifier));
            return;
        }

        if (ts.isExportDeclaration(node)) {
            const exportClause = node.exportClause;
            const allNamedExportsAreTypeOnly =
                Boolean(exportClause && ts.isNamedExports(exportClause) && exportClause.elements.length > 0
                    && exportClause.elements.every(element => element.isTypeOnly));
            const typeOnly = Boolean(node.isTypeOnly || allNamedExportsAreTypeOnly);
            if (node.moduleSpecifier) {
                addEdge(node, 'reexport', typeOnly ? 'type' : 'module-init', 'eager', literalSpecifier(node.moduleSpecifier));
            }
            return;
        }

        if (ts.isImportEqualsDeclaration(node)) {
            const moduleReference = node.moduleReference;
            if (ts.isExternalModuleReference(moduleReference)) {
                addEdge(node, 'require', node.isTypeOnly ? 'type' : 'module-init', 'eager', literalSpecifier(moduleReference.expression));
            }
            return;
        }

        if (ts.isImportTypeNode(node)) {
            addEdge(node, 'dynamic-import', 'type', 'deferred', importTypeSpecifier(node));
            node.forEachChild(child => visit(child, 'unknown', depth + 1));
            return;
        }

        if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
            node.forEachChild(child => {
                if (ts.isPropertyDeclaration(child)) {
                    visitClassProperty(child, phase, depth + 1);
                } else if (ts.isClassStaticBlockDeclaration(child)) {
                    visitClassStaticBlock(child, phase, depth + 1);
                } else if (isRuntimeMethod(child)) {
                    visitFunctionLike(child, phase, depth + 1);
                } else {
                    visit(child, phase, depth + 1);
                }
            });
            return;
        }

        if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
            if ((ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && isIifeFunction(node)) {
                addDiagnostic(
                    'iife-phase-conservative',
                    'IIFE body is conservatively classified as invocation; direct dispatch was not proven.',
                    node
                );
            }
            visitFunctionLike(node, phase, depth);
            return;
        }

        if (isRuntimeMethod(node)) {
            visitFunctionLike(node, phase, depth);
            return;
        }

        if (ts.isPropertyDeclaration(node)) {
            visitClassProperty(node, phase, depth);
            return;
        }

        if (ts.isClassStaticBlockDeclaration(node)) {
            visitClassStaticBlock(node, phase, depth);
            return;
        }

        if (ts.isCallExpression(node)) {
            if (isRequireCall(node)) {
                addEdge(node, 'require', phase, 'eager', literalSpecifier(node.arguments[0]));
                addDiagnostic(
                    'require-binding-ambiguous',
                    'require() dependency is syntactic evidence; its binding was not resolved and may be shadowed.',
                    node
                );
            } else if (isDynamicImportCall(node)) {
                addEdge(node, 'dynamic-import', phase, 'deferred', literalSpecifier(node.arguments[0]));
            }
            addEffect(node, 'call', phase);
            node.forEachChild(child => visit(child, phase, depth + 1));
            return;
        }

        if (ts.isNewExpression(node)) {
            addEffect(node, 'construct', phase);
            node.forEachChild(child => visit(child, phase, depth + 1));
            return;
        }

        node.forEachChild(child => visit(child, phase, depth + 1));
    };

    function visitFunctionLike(node: FunctionLikeNode, enclosingPhase: RuntimePhase, depth: number): void {
        const namedNode = node as ts.NamedDeclaration;
        const computedName = namedNode.name && ts.isComputedPropertyName(namedNode.name)
            ? namedNode.name
            : undefined;
        if (computedName) visit(computedName, enclosingPhase, depth + 1);
        node.forEachChild(child => {
            if (child === computedName) return;
            if (ts.isParameter(child)) {
                child.forEachChild(part => visit(part, ts.isDecorator(part) ? enclosingPhase : 'invocation', depth + 2));
            } else {
                visit(child, ts.isDecorator(child) ? enclosingPhase : 'invocation', depth + 1);
            }
        });
    }

    function visitClassProperty(node: ts.PropertyDeclaration, enclosingPhase: RuntimePhase, depth: number): void {
        const propertyPhase: RuntimePhase = isStaticProperty(node) ? enclosingPhase : 'unknown';
        node.forEachChild(child => {
            if (child === node.name && ts.isComputedPropertyName(child)) {
                visit(child, enclosingPhase, depth + 1);
            } else {
                visit(child, ts.isDecorator(child) ? enclosingPhase : propertyPhase, depth + 1);
            }
        });
    }

    function visitClassStaticBlock(node: ts.ClassStaticBlockDeclaration, enclosingPhase: RuntimePhase, depth: number): void {
        node.forEachChild(child => visit(child, enclosingPhase, depth + 1));
    }

    try {
        visit(sourceFile, 'module-init', 0);
    } catch (error: unknown) {
        if (error instanceof TraversalDepthLimitError || error instanceof RangeError) {
            addDiagnostic('traversal-depth', 'AST traversal stopped after exceeding the safe depth limit.');
        } else {
            addDiagnostic('traversal-failed', `AST traversal failed: ${errorMessage(error)}`);
        }
    }

    edges.sort(compareSourceOrder);
    effects.sort(compareSourceOrder);
    return { edges, effects, diagnostics };
}

function compareSourceOrder(left: { start: number; end: number }, right: { start: number; end: number }): number {
    return left.start - right.start || left.end - right.end;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function scriptKindFromFileName(file: string): ts.ScriptKind {
    const lower = file.toLocaleLowerCase();
    if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
    if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
    if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')) return ts.ScriptKind.TS;
    if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return ts.ScriptKind.JS;
    return ts.ScriptKind.Unknown;
}
