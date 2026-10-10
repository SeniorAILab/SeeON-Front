import path from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
// Use Vite's installed public dependency, not its private transform internals.
const glob = createRequire(require.resolve('vite/package.json'))('fast-glob')
const expandedEdgesCache = new WeakMap()
const programSourcesCache = new WeakMap()
const slash = (value) => value.split(path.sep).join('/')
const canonicalFile = (file) => {
  const name = path.resolve(ts.sys.realpath?.(file) ?? file)
  return ts.sys.useCaseSensitiveFileNames ? name : name.toLowerCase()
}
function programSourceFile(program, filename) {
  const exact = program.getSourceFile(filename)
  if (exact) return exact
  // Generated loader paths use the canonical project root; the Program may
  // retain a configured directory alias. Match physical identity, but return
  // the Program-owned SourceFile so its checker retains the actual exports.
  let sources = programSourcesCache.get(program)
  if (!sources) {
    sources = new Map()
    for (const source of program.getSourceFiles()) {
      const key = canonicalFile(source.fileName)
      if (!sources.has(key)) sources.set(key, source)
    }
    programSourcesCache.set(program, sources)
  }
  return sources.get(canonicalFile(filename))
}
const isTest = (file) => /(?:^|\/)(?:__tests__|test)\//.test(file) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)
const feature = (file) => /^src\/features\/([^/]+)\//.exec(file)?.[1]
const isUi = (file) => /^src\/(?:components|pages|hooks)\//.test(file) || /^src\/features\/[^/]+\/(?:components|pages|hooks)\//.test(file)
const componentLocation = (file) => /^src\/(?:components|pages)\//.test(file) || /^src\/features\/[^/]+\/(?:components|pages)\//.test(file)
const hookLocation = (file) => /^src\/hooks\//.test(file) || /^src\/features\/[^/]+\/hooks\//.test(file)
const isEndpoint = (file) => file.startsWith('src/services/api/')
const isClient = (file) => /^src\/services\/apiClient\.[cm]?[jt]sx?$/.test(file)
const isService = (file) => file.startsWith('src/services/') || /^src\/features\/[^/]+\/services\//.test(file)
const isBarrel = (file) => /^src\/features\/[^/]+\/index\.[cm]?[jt]sx?$/.test(file)

const roleCache = new WeakMap()
const componentIndexCache = new WeakMap()
const reactDeclaration = (node) => /\/node_modules\/(?:@types\/)?react\//.test(slash(node.getSourceFile().fileName))
const reactDomDeclaration = (node) => /\/node_modules\/(?:@types\/)?react-dom\//.test(slash(node.getSourceFile().fileName))
const routerDeclaration = (node) => /\/node_modules\/react-router(?:-dom)?\//.test(slash(node.getSourceFile().fileName))
const hookName = (name) => /^use[A-Z0-9]/.test(name)
const renderFactories = new Set(['createElement', 'cloneElement', 'jsx', 'jsxs', 'jsxDEV', 'memo', 'forwardRef', 'lazy'])

function zustandBoundStoreDeclaration(declaration) {
  if (!ts.isCallSignatureDeclaration(declaration) ||
      !/\/node_modules\/zustand\/(?:esm\/)?react\.d\.(?:ts|mts)$/.test(slash(declaration.getSourceFile().fileName))) return false
  // The overload must belong to the official React UseBoundStore type, not
  // Create, StoreApi.getState, a vanilla store, or a same-named local alias.
  for (let parent = declaration.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
    if (ts.isTypeAliasDeclaration(parent)) return parent.name.text === 'UseBoundStore'
  }
  return false
}

function componentIndex(program, root) {
  if (componentIndexCache.has(program)) return componentIndexCache.get(program)
  const checker = program.getTypeChecker()
  const index = { owners: new Set(), opaque: new Set() }
  componentIndexCache.set(program, index)
  const ownSource = (file) => {
    const relative = slash(path.relative(root, ts.sys.realpath?.(file.fileName) ?? file.fileName))
    return !file.isDeclarationFile && relative.startsWith('src/') && !isTest(relative)
  }
  const foreignDeclaration = (declaration) => slash(declaration.getSourceFile().fileName).includes('/node_modules/')
  function foreignCallableType(type) {
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false
    if (type.isUnion()) return type.types.every(foreignCallableType)
    const signatures = type.getCallSignatures()
    return signatures.length > 0 && signatures.every((signature) =>
      signature.declaration && foreignDeclaration(signature.declaration))
  }
  function foreignComponentValue(expression, allowPicker = true) {
    while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
           ts.isNonNullExpression(expression) || ts.isSatisfiesExpression(expression)) expression = expression.expression
    if (!foreignCallableType(checker.getTypeAtLocation(expression))) return false
    if (ts.isConditionalExpression(expression)) {
      return foreignComponentValue(expression.whenTrue, allowPicker) && foreignComponentValue(expression.whenFalse, allowPicker)
    }
    if (allowPicker && ts.isCallExpression(expression)) {
      const signature = checker.getResolvedSignature(expression)
      const declaration = signature?.declaration
      if (!declaration || !ownSource(declaration.getSourceFile()) || !declaration.body ||
          !foreignCallableType(checker.getReturnTypeOfSignature(signature))) return false
      // Certify only a local picker whose return expressions directly select
      // foreign callable values. No local assignment/return-flow engine or
      // recursive factory graph is inferred from a structural React type.
      if (!ts.isBlock(declaration.body)) return foreignComponentValue(declaration.body, false)
      const returns = []
      function visitReturn(node) {
        if (ts.isReturnStatement(node)) returns.push(node.expression)
        else if (!ts.isFunctionDeclaration(node) && !ts.isFunctionExpression(node) &&
                 !ts.isArrowFunction(node) && !ts.isClassDeclaration(node) && !ts.isMethodDeclaration(node)) ts.forEachChild(node, visitReturn)
      }
      ts.forEachChild(declaration.body, visitReturn)
      return returns.length > 0 && returns.every((value) => value && foreignComponentValue(value, false))
    }
    const symbolNode = ts.isPropertyAccessExpression(expression) ? expression.name : expression
    let symbol = checker.getSymbolAtLocation(symbolNode)
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
    return Boolean(symbol?.declarations?.length && symbol.declarations.every(foreignDeclaration))
  }
  function register(expression, site, seen = new Set()) {
    while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
           ts.isNonNullExpression(expression) || ts.isSatisfiesExpression(expression)) expression = expression.expression
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression) || ts.isClassExpression(expression)) {
      if (ownSource(expression.getSourceFile())) index.owners.add(expression.getSourceFile())
      return
    }
    if (ts.isConditionalExpression(expression)) {
      register(expression.whenTrue, site, seen)
      register(expression.whenFalse, site, seen)
      return
    }
    if (ts.isCallExpression(expression)) {
      if (!foreignComponentValue(expression)) index.opaque.add(site)
      return
    }
    const type = checker.getTypeAtLocation(expression)
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
      index.opaque.add(site)
      return
    }
    if (type.flags & ts.TypeFlags.StringLike) return
    const symbolNode = ts.isPropertyAccessExpression(expression) ? expression.name : expression
    let symbol = checker.getSymbolAtLocation(symbolNode)
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
    if (!symbol?.declarations?.length) {
      index.opaque.add(site)
      return
    }
    if (seen.has(symbol)) return
    seen.add(symbol)
    for (const declaration of symbol.declarations ?? []) {
      const owner = declaration.getSourceFile()
      if (!ownSource(owner)) continue
      if (((ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration) ||
            ts.isFunctionExpression(declaration) || ts.isArrowFunction(declaration)) && declaration.body) ||
          ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration)) {
        index.owners.add(owner)
      } else if (ts.isShorthandPropertyAssignment(declaration)) {
        const value = checker.getShorthandAssignmentValueSymbol(declaration)
        for (const target of value?.declarations ?? []) {
          if (target.name) register(target.name, site, seen)
        }
      } else if (ts.isExportAssignment(declaration)) {
        register(declaration.expression, site, seen)
      } else if (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) {
        let value = declaration.initializer
        while (value && (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) ||
                        ts.isNonNullExpression(value) || ts.isSatisfiesExpression(value))) value = value.expression
        if (value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value) || ts.isClassExpression(value))) {
          index.owners.add(owner)
        } else if (value && (ts.isIdentifier(value) || ts.isPropertyAccessExpression(value) || ts.isConditionalExpression(value))) {
          register(value, site, seen)
        } else if (value && ts.isCallExpression(value)) {
          const callable = checker.getResolvedSignature(value)?.declaration
          if (callable && reactDeclaration(callable) && renderFactories.has(callable.name?.getText())) index.owners.add(owner)
          else if (!foreignComponentValue(value)) index.opaque.add(owner)
        } else {
          index.opaque.add(owner)
        }
      }
      // Parameters/bindings supplied via props are not their callers' own
      // component definitions; interfaces and type aliases never own rendering.
    }
  }
  function visit(node, source) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName
      if (!(ts.isIdentifier(tag) && /^[a-z]/.test(tag.text)) && !ts.isJsxNamespacedName(tag)) register(tag, source)
    } else if (ts.isCallExpression(node)) {
      if (ts.isElementAccessExpression(node.expression) && !ts.isStringLiteral(node.expression.argumentExpression)) {
        ts.forEachChild(node, (child) => visit(child, source))
        return
      }
      const callable = checker.getResolvedSignature(node)?.declaration
      if (callable && reactDeclaration(callable) && callable.name?.getText() === 'createElement' && node.arguments[0]) {
        register(node.arguments[0], source)
      }
    }
    ts.forEachChild(node, (child) => visit(child, source))
  }
  for (const source of program.getSourceFiles()) {
    if (ownSource(source)) visit(source, source)
  }
  return index
}

// Local syntax and cached, compiler-resolved registration ownership establish
// role without an inferred runtime return-value/data-flow graph.
function roleFacts(program, sourceFile, root) {
  let files = roleCache.get(program)
  if (!files) roleCache.set(program, files = new WeakMap())
  if (files.has(sourceFile)) return files.get(sourceFile)
  const checker = program.getTypeChecker()
  const registrations = componentIndex(program, root)
  const facts = { rendering: registrations.owners.has(sourceFile), opaqueComponent: registrations.opaque.has(sourceFile), hooks: new Set(), unknownHooks: false, opaqueReact: false, rootCreated: false, rootRendered: false, router: false, hookRendering: false }
  files.set(sourceFile, facts)
  function ownerName(node) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isArrowFunction(parent) || ts.isMethodDeclaration(parent)) {
        if (parent.name && ts.isIdentifier(parent.name)) return parent.name.text
        if (ts.isVariableDeclaration(parent.parent) && ts.isIdentifier(parent.parent.name)) return parent.parent.name.text
        return ''
      }
    }
    return ''
  }
  function markRendering(node) {
    facts.rendering = true
    if (hookName(ownerName(node))) facts.hookRendering = true
  }
  function signature(node) {
    return checker.getResolvedSignature(node)?.declaration
  }
  function visit(node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) markRendering(node)
    if (ts.isCallExpression(node)) {
      let opaqueReact = false
      if (ts.isElementAccessExpression(node.expression) && !ts.isStringLiteral(node.expression.argumentExpression)) {
        const owner = checker.getTypeAtLocation(node.expression.expression).symbol
        opaqueReact = owner?.declarations?.some(reactDeclaration) ?? false
        if (opaqueReact) facts.opaqueReact = true
      }
      const declaration = opaqueReact ? undefined : signature(node)
      const name = declaration?.name?.getText() ?? ''
      if (declaration && reactDeclaration(declaration) && renderFactories.has(name)) markRendering(node)
      if (declaration && (zustandBoundStoreDeclaration(declaration) ||
          ((reactDeclaration(declaration) || reactDomDeclaration(declaration) || routerDeclaration(declaration)) &&
           (hookName(name) || (reactDeclaration(declaration) && name === 'use'))))) {
        facts.hooks.add(ownerName(node))
      } else {
        let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression)
        if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
        // A custom hook wrapper without local React evidence needs an explicit
        // classification instead of being silently treated as a pure helper.
        if (hookName(name) || hookName(symbol?.name ?? '')) facts.unknownHooks = true
      }
      if (declaration && reactDomDeclaration(declaration)) {
        if (name === 'createRoot' || name === 'hydrateRoot') facts.rootCreated = true
        if (name === 'render' || name === 'hydrateRoot') {
          facts.rootRendered = true
          markRendering(node)
        }
      }
      if (declaration && routerDeclaration(declaration) && name === 'createBrowserRouter') facts.router = true
    }
    if (ts.isVariableDeclaration(node) && node.initializer && node.type && ts.isTypeReferenceNode(node.type)) {
      let symbol = checker.getSymbolAtLocation(node.type.typeName)
      if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
      if (symbol && ['FC', 'FunctionComponent', 'ComponentType', 'ForwardRefExoticComponent'].includes(symbol.name) &&
          symbol.declarations?.some(reactDeclaration)) markRendering(node)
    }
    if (ts.isClassDeclaration(node)) {
      for (const clause of node.heritageClauses ?? []) {
        for (const base of clause.types) {
          let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(base.expression) ? base.expression.name : base.expression)
          if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
          if (symbol && ['Component', 'PureComponent'].includes(symbol.name) && symbol.declarations?.some(reactDeclaration)) markRendering(node)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  const exports = sourceFile.statements.filter((node) =>
    ts.isExportAssignment(node) || ts.isExportDeclaration(node) || node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
  facts.bootstrap = facts.rootCreated && facts.rootRendered && exports.length === 0
  facts.routeComposition = facts.router && exports.length > 0 && exports.every((node) =>
    ts.isVariableStatement(node) && node.declarationList.declarations.every((declaration) => {
      if (!declaration.initializer || !ts.isCallExpression(declaration.initializer)) return false
      const target = signature(declaration.initializer)
      return target && routerDeclaration(target) && target.name?.getText() === 'createBrowserRouter'
    }))
  return facts
}

const wireCache = new WeakMap()
const wireFile = /^src\/services\/api\/[^/]+\/dto\/[a-z0-9]+(?:-[a-z0-9]+)*-(?:request|response|query|params)\.dto\.ts$/

// Wire identity comes from a transport use or an explicit unknown-input mapper
// slot, never structural equality with a domain model. This deliberately does
// not infer assignments, function bodies, or arbitrary runtime return flow.
function wireIndex(program, root) {
  if (wireCache.has(program)) return wireCache.get(program)
  const checker = program.getTypeChecker()
  const relative = (file) => slash(path.relative(root, ts.sys.realpath?.(file) ?? file))
  const own = (node) => {
    const file = node.getSourceFile()
    const name = relative(file.fileName)
    return !file.isDeclarationFile && name.startsWith('src/') && !isTest(name)
  }
  const unalias = (symbol) => symbol?.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  const symbolAt = (node) => unalias(checker.getSymbolAtLocation(
    ts.isPropertyAccessExpression(node) ? node.name : node))
  const unwrap = (node) => {
    while (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node) ||
           ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) ||
           ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) node = node.expression
    return node
  }
  function transportSymbol(symbol, names, seen = new Set()) {
    symbol = unalias(symbol)
    if (!symbol || seen.has(symbol)) return false
    seen.add(symbol)
    for (const declaration of symbol.declarations ?? []) {
      if (isClient(relative(declaration.getSourceFile().fileName)) && names.includes(declaration.name?.getText())) return true
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        const value = unwrap(declaration.initializer)
        if ((ts.isIdentifier(value) || ts.isPropertyAccessExpression(value)) &&
            transportSymbol(symbolAt(value), names, seen)) return true
      }
      if (ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent)) {
        const name = declaration.propertyName ?? declaration.name
        if ((ts.isIdentifier(name) || ts.isStringLiteral(name)) &&
            transportSymbol(checker.getTypeAtLocation(declaration.parent).getProperty(name.text), names, seen)) return true
      }
    }
    return false
  }
  function transport(node, jsonOnly = true) {
    if (!ts.isCallExpression(node)) return false
    const names = jsonOnly ? ['requestJson'] : ['requestJson', 'requestNoContent', 'requestResponse']
    const declaration = checker.getResolvedSignature(node)?.declaration
    const name = declaration?.name?.getText() ?? declaration?.parent?.name?.getText()
    return Boolean(declaration && isClient(relative(declaration.getSourceFile().fileName)) &&
      names.includes(name) || transportSymbol(symbolAt(node.expression), names))
  }
  function raw(node, seen = new Set()) {
    node = unwrap(node)
    if (transport(node)) return true
    if (!ts.isIdentifier(node)) return false
    const symbol = symbolAt(node)
    if (!symbol || seen.has(symbol)) return false
    seen.add(symbol)
    return (symbol.declarations ?? []).some((declaration) =>
      ts.isVariableDeclaration(declaration) && declaration.initializer &&
      (declaration.parent.flags & ts.NodeFlags.Const) && raw(declaration.initializer, seen))
  }
  // TS syntax preserves transparent wrappers that structural types erase
  // (Pick<T>, keyof T, interface extends T, ReturnType<typeof mapper>).
  function returnDeclarations(type, result, seen = new Set()) {
    if (seen.has(type)) return
    seen.add(type)
    for (const declaration of (type.aliasSymbol ?? type.symbol)?.declarations ?? []) {
      if (own(declaration) && (ts.isTypeAliasDeclaration(declaration) || ts.isInterfaceDeclaration(declaration))) result.add(declaration)
    }
    for (const child of type.aliasTypeArguments ?? []) returnDeclarations(child, result, seen)
    if (type.isUnionOrIntersection()) for (const child of type.types) returnDeclarations(child, result, seen)
    if (type.flags & ts.TypeFlags.Object && type.objectFlags & ts.ObjectFlags.Reference) {
      for (const child of checker.getTypeArguments(type)) returnDeclarations(child, result, seen)
    }
  }
  function declarations(node, seen = new Set(), result = new Set()) {
    if (!node) return result
    if (ts.isTypeReferenceNode(node) || ts.isExpressionWithTypeArguments(node) || ts.isTypeQueryNode(node)) {
      const name = ts.isTypeReferenceNode(node) ? node.typeName
        : ts.isTypeQueryNode(node) ? node.exprName : node.expression
      const symbol = symbolAt(name)
      if (symbol && !seen.has(symbol)) {
        seen.add(symbol)
        for (const declaration of symbol.declarations ?? []) {
          if (!own(declaration)) continue
          if (ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration)) {
            result.add(declaration)
            if (ts.isTypeAliasDeclaration(declaration)) declarations(declaration.type, seen, result)
            for (const clause of declaration.heritageClauses ?? []) declarations(clause, seen, result)
          } else if (ts.isFunctionDeclaration(declaration) || ts.isVariableDeclaration(declaration)) {
            // Only the compiler's declared signature, not body/dataflow inference.
            if (declaration.type) declarations(declaration.type, seen, result)
            const type = checker.getTypeAtLocation(declaration)
            for (const signature of type.getCallSignatures()) {
              if (signature.declaration?.type) declarations(signature.declaration.type, seen, result)
              const returned = checker.getReturnTypeOfSignature(signature)
              returnDeclarations(returned, result)
            }
          }
        }
      }
    }
    ts.forEachChild(node, (child) => { declarations(child, seen, result) })
    return result
  }
  const index = { slots: new Map(), identities: new Set(), origin: null }
  wireCache.set(program, index)
  function add(source, node, type) {
    const found = declarations(type)
    if (!ts.isTypeNode(type)) returnDeclarations(checker.getTypeAtLocation(type), found)
    // Transparent aliases are allowed, but do not replace their payload owner.
    const owners = [...found].filter((declaration) =>
      ts.isInterfaceDeclaration(declaration) ||
      ts.isTypeAliasDeclaration(declaration) && ts.isTypeLiteralNode(declaration.type))
    for (const declaration of found) index.identities.add(declaration)
    const slots = index.slots.get(source) ?? []
    if (!slots.some((slot) => slot.node === node && slot.type === type)) slots.push({ node, type, owners })
    index.slots.set(source, slots)
  }
  function genericGuard(type) {
    if (!ts.isTypeReferenceNode(type) || type.typeArguments?.length !== 2) return false
    const symbol = symbolAt(type.typeName)
    return symbol?.name === 'Record' && symbol.declarations?.every((node) => !own(node)) &&
      type.typeArguments[0].kind === ts.SyntaxKind.StringKeyword &&
      type.typeArguments[1].kind === ts.SyntaxKind.UnknownKeyword
  }
  function hasTypeParameter(node) {
    if (checker.getTypeAtLocation(node).flags & ts.TypeFlags.TypeParameter) return true
    return Boolean(ts.forEachChild(node, hasTypeParameter))
  }
  function mapperReturn(node) {
    if (!ts.isReturnStatement(node.parent) && !(ts.isArrowFunction(node.parent) && node.parent.body === node)) return false
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isArrowFunction(parent)) {
        // Explicit unknown-input, non-generic parser signatures are a wire
        // contract slot; ordinary computational returns are not classified.
        return !parent.typeParameters?.length && parent.parameters.some((parameter) =>
          parameter.type?.kind === ts.SyntaxKind.UnknownKeyword)
      }
    }
    return false
  }
  function rejectOptions(source, site) {
    const slots = index.slots.get(source) ?? []
    if (!slots.some((slot) => slot.node === site && slot.type === null)) slots.push({ node: site, type: null, owners: [] })
    index.slots.set(source, slots)
  }
  function payloadSlot(source, site, node) {
    const type = checker.getTypeAtLocation(node)
    // A canonical arm must not launder an anonymous/erased union arm.
    if (type.isUnion() && type.types.some((member) => {
      const targets = new Set()
      returnDeclarations(member, targets)
      return targets.size === 0
    })) rejectOptions(source, site)
    else add(source, site, node)
  }
  function jsonStringify(node) {
    if (!ts.isCallExpression(node)) return false
    const declaration = checker.getResolvedSignature(node)?.declaration
    return declaration?.name?.getText() === 'stringify' &&
      /\/lib\.es5\.d\.ts$/.test(slash(declaration.getSourceFile().fileName))
  }
  function knownJsonStringify(node, seen = new Set()) {
    node = unwrap(node)
    if (jsonStringify(node)) return true
    if (!ts.isIdentifier(node)) return false
    const symbol = symbolAt(node)
    if (!symbol || seen.has(symbol)) return false
    seen.add(symbol)
    return (symbol.declarations ?? []).some((declaration) =>
      ts.isVariableDeclaration(declaration) && declaration.initializer &&
      declaration.parent.flags & ts.NodeFlags.Const && knownJsonStringify(declaration.initializer, seen))
  }
  function requestBodyBinding(symbol, source, seen, site) {
    symbol = unalias(symbol)
    if (!symbol || seen.has(symbol)) return
    seen.add(symbol)
    for (const declaration of symbol.declarations ?? []) {
      if (!ts.isVariableDeclaration(declaration) || !declaration.initializer) continue
      if (declaration.parent.flags & ts.NodeFlags.Const) requestBody(declaration.initializer, source, seen, site)
      else if (knownJsonStringify(declaration.initializer)) rejectOptions(source, site)
    }
  }
  function requestBody(node, source, seen = new Set(), site = node) {
    // Follow only immutable syntax bindings for RequestInit/body construction.
    if (ts.isIdentifier(node)) {
      requestBodyBinding(symbolAt(node), source, seen, site)
      return
    }
    if (ts.isCallExpression(node)) {
      if (jsonStringify(node)) {
        const payload = node.arguments[0]
        if (!payload) return
        if (ts.isSatisfiesExpression(payload) || ts.isAsExpression(payload)) payloadSlot(source, site, payload.type)
        else if (ts.isIdentifier(payload)) {
          let typed = false
          for (const binding of symbolAt(payload)?.declarations ?? []) {
            if ((ts.isVariableDeclaration(binding) || ts.isParameter(binding)) && binding.type) {
              typed = true
              payloadSlot(source, site, binding.type)
            }
            else if (ts.isVariableDeclaration(binding) && binding.initializer &&
                     ts.isSatisfiesExpression(binding.initializer)) {
              typed = true
              payloadSlot(source, site, binding.initializer.type)
            }
          }
          if (!typed) payloadSlot(source, site, payload)
        } else payloadSlot(source, site, payload)
        return
      }
    }
    ts.forEachChild(node, (child) => requestBody(child, source, seen, site))
  }
  const functionBody = (node) => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
  function signalAssignment(node, symbol) {
    if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false
    const target = node.left
    const name = ts.isPropertyAccessExpression(target) ? target.name.text
      : ts.isElementAccessExpression(target) && ts.isStringLiteral(target.argumentExpression) ? target.argumentExpression.text : null
    return name === 'signal' && symbolAt(target.expression) === symbol
  }
  function stableOptions(binding, returned = null) {
    if (!(binding.parent.flags & ts.NodeFlags.Const) ||
        binding.parent.parent.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) return false
    const symbol = symbolAt(binding.name)
    let scope = binding.parent
    while (scope.parent && !functionBody(scope) && !ts.isSourceFile(scope)) scope = scope.parent
    let stable = true
    function inspect(node) {
      if (!stable) return
      if (ts.isIdentifier(node) && node !== binding.name && symbolAt(node) === symbol) {
        const parent = node.parent
        const returning = parent === returned && parent.expression === node
        const consuming = ts.isCallExpression(parent) && parent.arguments[1] === node && transport(parent, false)
        const copying = ts.isSpreadAssignment(parent) && parent.expression === node
        const settingSignal = (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
          parent.expression === node && signalAssignment(parent.parent, symbol)
        if (!returning && !consuming && !copying && !settingSignal) stable = false
      }
      ts.forEachChild(node, inspect)
    }
    inspect(scope)
    return stable
  }
  function literalFactory(call) {
    const declaration = checker.getResolvedSignature(call)?.declaration
    if (!declaration || !functionBody(declaration) || !declaration.body ||
        declaration.asteriskToken || declaration.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) return null
    if (!ts.isBlock(declaration.body)) {
      const value = unwrap(declaration.body)
      return ts.isObjectLiteralExpression(value) ? value : null
    }
    const statements = declaration.body.statements
    const returned = statements.at(-1)
    if (!returned || !ts.isReturnStatement(returned) || !returned.expression) return null
    const value = unwrap(returned.expression)
    if (ts.isObjectLiteralExpression(value)) return statements.length === 1 ? value : null
    if (!ts.isIdentifier(value)) return null
    const binding = symbolAt(value)?.declarations?.find((node) => ts.isVariableDeclaration(node))
    if (!binding?.initializer || binding.parent.parent.parent !== declaration.body || statements[0] !== binding.parent.parent ||
        !ts.isObjectLiteralExpression(unwrap(binding.initializer)) || !stableOptions(binding, returned)) return null
    const symbol = symbolAt(binding.name)
    // A syntax certificate, not control-flow interpretation: literal creation,
    // optional signal assignments, and the final return are the only statements.
    function signalOnly(statement) {
      if (ts.isBlock(statement)) return statement.statements.every(signalOnly)
      if (ts.isIfStatement(statement)) return signalOnly(statement.thenStatement) &&
        (!statement.elseStatement || signalOnly(statement.elseStatement))
      return ts.isExpressionStatement(statement) && signalAssignment(statement.expression, symbol)
    }
    if (!statements.every((statement) => statement === returned ||
      statement === binding.parent.parent && statement.declarationList.declarations.length === 1 ||
      signalOnly(statement))) return null
    return unwrap(binding.initializer)
  }
  function requestOptions(node, source, seen = new Set(), site = node, factoryDepth = 0) {
    node = unwrap(node)
    if (node.kind === ts.SyntaxKind.NullKeyword ||
        ts.isIdentifier(node) && node.text === 'undefined' && !symbolAt(node)?.declarations?.some(own)) return
    if (ts.isIdentifier(node)) {
      const symbol = symbolAt(node)
      if (!symbol || seen.has(symbol)) {
        rejectOptions(source, site)
        return
      }
      seen.add(symbol)
      let supported = false
      for (const declaration of symbol.declarations ?? []) {
        if (ts.isVariableDeclaration(declaration) && declaration.initializer &&
            stableOptions(declaration)) {
          supported = true
          requestOptions(declaration.initializer, source, seen, site, factoryDepth)
        }
      }
      if (!supported) rejectOptions(source, site)
    } else if (ts.isCallExpression(node)) {
      const literal = factoryDepth === 0 ? literalFactory(node) : null
      if (!literal) rejectOptions(source, site)
      else requestOptions(literal, source, seen, site, factoryDepth + 1)
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (ts.isSpreadAssignment(property)) requestOptions(property.expression, source, new Set(seen), site, factoryDepth)
        else {
          const name = ts.isComputedPropertyName(property.name) ? property.name.expression : property.name
          if (!ts.isIdentifier(name) && !ts.isStringLiteral(name) ||
              ts.isComputedPropertyName(property.name) && !ts.isStringLiteral(name)) {
            rejectOptions(source, site)
            continue
          }
          if (name.text !== 'body') continue
          if (ts.isPropertyAssignment(property)) requestBody(property.initializer, source, new Set(), site)
          else if (ts.isShorthandPropertyAssignment(property)) {
            requestBodyBinding(checker.getShorthandAssignmentValueSymbol(property), source, new Set(), site)
          } else {
            rejectOptions(source, site)
          }
        }
      }
    } else rejectOptions(source, site)
  }
  function visit(node, source) {
    const endpoint = isEndpoint(relative(source.fileName))
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) {
      const direct = raw(node.expression)
      const unknown = checker.getTypeAtLocation(node.expression).flags & ts.TypeFlags.Unknown
      const parameterized = hasTypeParameter(node.type)
      if ((direct || endpoint && !parameterized && (unknown || ts.isSatisfiesExpression(node) && mapperReturn(node))) &&
          node.type.kind !== ts.SyntaxKind.UnknownKeyword && (direct || !genericGuard(node.type))) add(source, node, node.type)
    }
    if (ts.isVariableDeclaration(node) && node.type && node.initializer && raw(node.initializer) &&
        node.type.kind !== ts.SyntaxKind.UnknownKeyword) add(source, node, node.type)
    if (ts.isVariableDeclaration(node) && node.initializer && raw(node.initializer) &&
        !(node.parent.flags & ts.NodeFlags.Const)) add(source, node, node.name)
    if (ts.isCallExpression(node) && node.arguments.some((argument) => raw(argument))) {
      for (const type of node.typeArguments ?? []) add(source, node, type)
    }
    if (transport(node, false) && node.arguments[1]) requestOptions(node.arguments[1], source)
    ts.forEachChild(node, (child) => visit(child, source))
  }
  for (const source of program.getSourceFiles()) if (own(source) && !isClient(relative(source.fileName))) visit(source, source)
  index.origin = (symbol) => {
    symbol = unalias(symbol)
    for (const declaration of symbol?.declarations ?? []) {
      if (index.identities.has(declaration)) return relative(declaration.getSourceFile().fileName)
      if (!ts.isTypeAliasDeclaration(declaration) && !ts.isInterfaceDeclaration(declaration)) continue
      const referenced = declarations(declaration)
      for (const target of referenced) {
        if (index.identities.has(target) || isEndpoint(relative(target.getSourceFile().fileName))) {
          return relative(target.getSourceFile().fileName)
        }
      }
    }
    return null
  }
  return index
}

const wireOwnershipRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      owner: 'Wire payload declarations must use *Dto names in src/services/api/<domain>/dto/<operation>-<request|response|query|params>.dto.ts.',
      unsupported: 'Wire payload use has no attributable canonical DTO declaration; use an explicit domain wire DTO rather than an inline, erased, or opaque payload type.',
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices
    if (!services?.program || !services.esTreeNodeToTSNodeMap) return {}
    const configuredRoot = context.languageOptions.parserOptions.tsconfigRootDir ?? context.cwd
    const root = ts.sys.realpath?.(configuredRoot) ?? configuredRoot
    return {
      Program(node) {
        const source = services.esTreeNodeToTSNodeMap.get(node)
        const index = wireIndex(services.program, root)
        for (const slot of index.slots.get(source) ?? []) {
          const messageId = slot.owners.length === 0 ? 'unsupported'
            : slot.owners.some((declaration) =>
              !/^[A-Z][A-Za-z0-9]*Dto$/.test(declaration.name.text) ||
              !wireFile.test(slash(path.relative(root, ts.sys.realpath?.(declaration.getSourceFile().fileName) ??
                declaration.getSourceFile().fileName)))) ? 'owner' : null
          if (messageId) context.report({ node: services.tsNodeToESTreeNodeMap.get(slot.node), messageId })
        }
      },
    }
  },
}

// TypeScript owns module resolution and symbol aliasing; this only classifies
// resolved files and transparent exports, not arbitrary runtime data flow.
function createBoundaryRule(kind) {
  return {
    meta: {
      type: 'problem',
      schema: [],
      messages: {
        feature: 'Import feature {{feature}} through its index.ts public API, not {{target}}.',
        endpoint: 'UI and feature exports must consume service façades, not endpoint or wire declarations from {{target}}.',
        transport: 'Backend transport belongs in services; only apiErrorMessage is a UI-safe apiClient import.',
        test: 'Production code must not import test-only module {{target}}.',
        unresolved: 'Cannot resolve {{target}} with the TypeScript project; architecture enforcement cannot safely classify this import.',
        outsideProduction: 'Production runtime imports must stay inside enforced src code or actual external libraries, not local executable {{target}}.',
        unsupportedLoader: 'Cannot classify this glob/Worker loader from supported literal patterns, options, and native identities.',
        unresolvedGlob: 'Glob patterns have no resolvable file or directory base; a missing target is not a certified empty glob.',
        computed: 'Computed module imports cannot be classified by architecture rules; use a static module specifier.',
        services: 'Architecture rules require TypeScript parser services and a project-backed program.',
        fetch: 'Native backend fetch belongs only in src/services/apiClient.ts.',
        unknownFetch: 'Cannot establish that this native fetch is a static non-API asset request; backend transport belongs in src/services/apiClient.ts.',
        escapedFetch: 'Native fetch capability escapes supported direct/static invocation analysis; keep backend transport in src/services/apiClient.ts.',
        componentName: 'Rendering modules must use a PascalCase.tsx filename.',
        componentPlacement: 'Component definitions belong in src/components, src/pages, or their feature components/pages directory.',
        hookPlacement: 'Hook modules belong in src/hooks or their feature hooks directory.',
        opaqueComponent: 'A registered component has no statically attributable own callable definition; expose a concrete component declaration rather than an opaque registration.',
        pageName: 'Rendering modules in pages must use a PascalCasePage.tsx filename.',
        hookName: 'Hook-only modules and their hook callables must use use<Name>.ts(x) names.',
        ambiguousRole: 'Cannot safely classify this React/custom-hook module from local rendering and resolved hook declarations; separate rendering from hook logic or expose an explicit React component type.',
      },
    },
    create(context) {
      const services = context.sourceCode.parserServices
      const program = services?.program
      if (!program || !services.esTreeNodeToTSNodeMap) {
        return kind === 'resolution' ? { Program(node) { context.report({ node, messageId: 'services' }) } } : {}
      }
      const checker = program.getTypeChecker()
      const configuredRoot = context.languageOptions.parserOptions.tsconfigRootDir ?? context.cwd
      const root = ts.sys.realpath?.(configuredRoot) ?? configuredRoot
      const filename = context.filename
      const relative = (file) => slash(path.relative(root, ts.sys.realpath?.(file) ?? file))
      const source = relative(filename)
      const sourceFeature = feature(source)
      const production = !isTest(source)
      const facts = production && (kind === 'seam' || kind === 'names')
        ? roleFacts(program, services.esTreeNodeToTSNodeMap.get(context.sourceCode.ast), root) : null
      const ui = production && (isUi(source) || facts?.rendering || facts?.opaqueComponent || facts?.hooks.size || facts?.unknownHooks || facts?.opaqueReact || facts?.router)
      const compilerOptions = program.getCompilerOptions()
      const cache = ts.createModuleResolutionCache(root, (file) => file, compilerOptions)
      const reported = new Set()
      function report(node, messageId, target = '') {
        const key = `${node.range?.[0]}:${messageId}:${target}`
        if (reported.has(key)) return
        reported.add(key)
        context.report({ node, messageId, data: { target, feature: feature(target) } })
      }

      const enforceFetch = kind === 'seam' && production && !isClient(source)
      const valueReferences = new Set(enforceFetch ? context.sourceCode.scopeManager.scopes.flatMap((scope) =>
        scope.references.filter((reference) => reference.isValueReference !== false && reference.isRead()).map((reference) => reference.identifier)) : [])
      const nativeFetchDeclaration = (declaration) => declaration?.name?.getText() === 'fetch' &&
        /(?:^|\/)lib\.(?:dom|webworker)\.d\.ts$/.test(slash(declaration.getSourceFile().fileName))
      function nativeFetchSymbol(symbol, seen = new Set()) {
        if (!symbol || seen.has(symbol)) return false
        seen.add(symbol)
        if (symbol.flags & ts.SymbolFlags.Alias) return nativeFetchSymbol(checker.getAliasedSymbol(symbol), seen)
        return (symbol.declarations ?? []).some((declaration) => {
          if (nativeFetchDeclaration(declaration)) return true
          // Only transparent bindings are followed, never function bodies,
          // arbitrary calls, reassignment flow, or structural type lookalikes.
          if (ts.isVariableDeclaration(declaration) && declaration.initializer) return nativeFetchValue(declaration.initializer, seen)
          if (ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent)) {
            let name = declaration.propertyName ?? declaration.name
            if (ts.isComputedPropertyName(name)) name = name.expression
            if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
              return nativeFetchSymbol(checker.getTypeAtLocation(declaration.parent).getProperty(name.text), seen)
            }
          }
          return false
        })
      }
      function nativeFetchValue(expression, seen = new Set()) {
        while (ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression) ||
               ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isSatisfiesExpression(expression)) expression = expression.expression
        const symbolNode = ts.isPropertyAccessExpression(expression) ? expression.name
          : ts.isElementAccessExpression(expression) ? expression.argumentExpression : expression
        const symbol = checker.getSymbolAtLocation(symbolNode) ??
          (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression)
            ? checker.getTypeAtLocation(expression.expression).getProperty(expression.argumentExpression.text) : undefined)
        return nativeFetchSymbol(symbol, seen)
      }
      function preservesNativeSignature(node) {
        return checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node)).getCallSignatures()
          .some((signature) => signature.declaration && nativeFetchDeclaration(signature.declaration))
      }
      function fetchOperation(callee) {
        if (callee.type !== 'MemberExpression') return null
        const method = callee.computed ? callee.property.value : callee.property.name
        if (!['call', 'apply', 'bind'].includes(method) ||
            !nativeFetchValue(services.esTreeNodeToTSNodeMap.get(callee.object))) return null
        const base = services.esTreeNodeToTSNodeMap.get(callee.object)
        const member = services.esTreeNodeToTSNodeMap.get(callee)
        const symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(member) ? member.name : member.argumentExpression) ??
          checker.getTypeAtLocation(base).getProperty(method)
        return symbol?.declarations?.some((declaration) => /(?:^|\/)lib\.es5\.d\.ts$/.test(slash(declaration.getSourceFile().fileName))) ? method : null
      }
      function checkFetchUrl(node, argument) {
        const value = argument?.type === 'Literal' && typeof argument.value === 'string' ? argument.value
          : argument?.type === 'TemplateLiteral' && argument.expressions.length === 0 ? argument.quasis[0].value.cooked : null
        if (value === null) {
          report(node, 'unknownFetch')
          return
        }
        try {
          const url = new URL(value, 'https://frontend.invalid/')
          if (url.protocol === 'data:' || url.protocol === 'blob:') return
          if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            report(node, 'unknownFetch')
            return
          }
          // URL handles relative paths, backslashes and dot segments; query
          // suffixes never establish that a request is an asset.
          const pathname = decodeURIComponent(url.pathname)
          if (/^\/api(?:\/|$)/i.test(pathname)) report(node, 'fetch')
          else if (/%(?:2f|5c|3f|23)/i.test(url.pathname) ||
                   !/\.(?:css|svg|png|jpe?g|gif|webp|woff2?|mp3|wav|mp4)$/i.test(pathname)) report(node, 'unknownFetch')
        } catch {
          report(node, 'unknownFetch')
        }
      }
      function checkFetchReference(node) {
        if (!enforceFetch || !nativeFetchValue(services.esTreeNodeToTSNodeMap.get(node))) return
        let expression = node
        while (['TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression', 'TSSatisfiesExpression', 'ChainExpression'].includes(expression.parent?.type)) {
          if (!preservesNativeSignature(expression.parent)) {
            report(node, 'escapedFetch')
            return
          }
          expression = expression.parent
        }
        const parent = expression.parent
        if (parent?.type === 'CallExpression' && parent.callee === expression) return
        if (parent?.type === 'TSTypeQuery') return
        if (parent?.type === 'UnaryExpression' && parent.operator === 'typeof') return
        if (parent?.type === 'MemberExpression' && parent.object === expression && fetchOperation(parent) &&
            parent.parent?.type === 'CallExpression' && parent.parent.callee === parent) return
        if (parent?.type === 'VariableDeclarator' && parent.init === expression && parent.id.type === 'Identifier' &&
            parent.parent.kind === 'const' && parent.parent.parent?.type !== 'ExportNamedDeclaration' && preservesNativeSignature(parent.id)) return
        report(node, 'escapedFetch')
      }

      function forbiddenOrigin(symbol, location, seen = new Set(), originKind = kind) {
        if (!symbol || seen.has(symbol)) return null
        if (originKind === 'seam') {
          const wire = wireIndex(program, root).origin(symbol)
          if (wire) return wire
        }
        seen.add(symbol)
        if (symbol.flags & ts.SymbolFlags.Alias) {
          const resolved = checker.getAliasedSymbol(symbol)
          if (resolved !== symbol) {
            const forbidden = forbiddenOrigin(resolved, location, seen, originKind)
            if (forbidden) return forbidden
          }
        }
        for (const declaration of symbol.declarations ?? []) {
          const origin = relative(declaration.getSourceFile().fileName)
          if (originKind === 'tests' && isTest(origin)) return origin
          if (originKind === 'seam' && isEndpoint(origin)) {
            return origin
          }
          if (originKind === 'seam' && isClient(origin) && symbol.name !== 'apiErrorMessage' && !ts.isSourceFile(declaration)) return origin
          // An actual service declaration is the boundary, not an alias to an
          // endpoint; do not inspect service implementations or return types.
          if (isService(origin) && !isClient(origin)) continue
          if (ts.isShorthandPropertyAssignment(declaration)) {
            const forbidden = forbiddenOrigin(checker.getShorthandAssignmentValueSymbol(declaration), location, seen, originKind)
            if (forbidden) return forbidden
          }
          if (ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent)) {
            const name = declaration.propertyName ?? declaration.name
            if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
              const property = checker.getTypeAtLocation(declaration.parent).getProperty(name.text)
              const forbidden = forbiddenOrigin(property, location, seen, originKind)
              if (forbidden) return forbidden
            }
          }
          const expression = ts.isExportAssignment(declaration) ? declaration.expression
            : ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration) ? declaration.initializer : null
          if (expression && (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression))) {
            const forbidden = forbiddenOrigin(checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expression) ? expression.name : expression), expression, seen, originKind)
            if (forbidden) return forbidden
          }
          if (expression && ts.isObjectLiteralExpression(expression)) {
            for (const property of checker.getTypeAtLocation(expression).getProperties()) {
              const forbidden = forbiddenOrigin(property, expression, seen, originKind)
              if (forbidden) return forbidden
            }
          }
          if (ts.isSourceFile(declaration) && !isClient(origin)) {
            for (const exported of checker.getExportsOfModule(symbol)) {
              const forbidden = forbiddenOrigin(exported, location, seen, originKind)
              if (forbidden) return forbidden
            }
          }
        }
        return null
      }

      function erasedModuleEdge(node) {
        if (ts.isImportTypeNode(node)) return true
        if (ts.isImportEqualsDeclaration(node)) return node.isTypeOnly
        if (ts.isImportDeclaration(node)) {
          const clause = node.importClause
          if (clause?.isTypeOnly) return true
          const bindings = clause?.namedBindings
          // Under verbatimModuleSyntax, inline type specifiers can leave an
          // empty runtime import; only a whole `import type` is unconditional.
          return !compilerOptions.verbatimModuleSyntax && !clause?.name &&
            bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 &&
            bindings.elements.every((element) => element.isTypeOnly)
        }
        if (ts.isExportDeclaration(node)) {
          return node.isTypeOnly || !compilerOptions.verbatimModuleSyntax &&
            node.exportClause && ts.isNamedExports(node.exportClause) &&
            node.exportClause.elements.length > 0 && node.exportClause.elements.every((element) => element.isTypeOnly)
        }
        return false
      }

      function inspect(node, literal, exporting = false, generated = false, importedName = null, forceExecutable = false, runtimeTarget = null) {
        if (!literal || typeof literal.value !== 'string') {
          if (production && kind === 'resolution') report(node, 'computed')
          return
        }
        const specifier = literal.value
        const resolved = ts.resolveModuleName(specifier, filename, compilerOptions, ts.sys, cache).resolvedModule
        if (!resolved) {
          // Styles/assets are Vite resources, not TypeScript module targets.
          // Local code, bare packages and unknown suffixes fail closed.
          if (kind === 'resolution' && production && (forceExecutable ||
              !/\.(?:css|scss|svg|png|jpe?g|gif|webp|woff2?)(?:\?.*)?$/.test(specifier))) report(node, 'unresolved', specifier)
          return
        }
        const target = relative(runtimeTarget ?? resolved.resolvedFileName)
        const tsNode = services.esTreeNodeToTSNodeMap.get(node)
        // Resolution provenance, not the import's spelling, establishes a
        // library/data exemption. Local declaration files are not value-safe:
        // an extensionless .d.ts can accompany unlinted executable JavaScript.
        const dataTarget = !forceExecutable && /\.(?:json|css|scss|svg|png|jpe?g|gif|webp|woff2?)$/i.test(target)
        const outsideProduction = kind === 'resolution' && production && source.startsWith('src/') &&
          !target.startsWith('src/') && !isTest(target) && !resolved.isExternalLibraryImport &&
          !dataTarget && !erasedModuleEdge(tsNode)
        if (kind === 'tests' && production && isTest(target)) report(node, 'test', target)
        if (kind === 'feature' && production && feature(target) && feature(target) !== sourceFeature && !/^src\/features\/[^/]+\/index\.ts$/.test(target)) report(node, 'feature', target)
        if (!outsideProduction && !(kind === 'tests' && production) &&
            !(kind === 'seam' && (ui || (production && exporting && isBarrel(source))))) return
        if (kind === 'seam' && isEndpoint(target)) {
          report(node, 'endpoint', target)
          return
        }
        const symbols = []
        if (ts.isImportDeclaration(tsNode)) {
          if (tsNode.importClause?.name) symbols.push(checker.getSymbolAtLocation(tsNode.importClause.name))
          const bindings = tsNode.importClause?.namedBindings
          if (bindings && ts.isNamedImports(bindings)) {
            for (const element of bindings.elements) symbols.push(checker.getSymbolAtLocation(element.name))
          } else if (bindings && !isClient(target)) symbols.push(checker.getSymbolAtLocation(bindings.name))
          if (kind === 'seam' && !tsNode.importClause && isClient(target)) report(node, 'transport')
        } else if (ts.isExportDeclaration(tsNode) && tsNode.exportClause && ts.isNamedExports(tsNode.exportClause)) {
          for (const element of tsNode.exportClause.elements) symbols.push(checker.getSymbolAtLocation(element.name))
        } else {
          const tsLiteral = generated ? programSourceFile(program, resolved.resolvedFileName)
            : services.esTreeNodeToTSNodeMap.get(literal)
          const moduleSymbol = tsLiteral && checker.getSymbolAtLocation(tsLiteral)
          if (moduleSymbol) symbols.push(...checker.getExportsOfModule(moduleSymbol)
            .filter((symbol) => importedName === null || symbol.name === importedName))
        }
        if (outsideProduction) {
          // Keep the existing production->test diagnostic authoritative, even
          // when a transparent outside barrel exposes the test symbol.
          if (!symbols.some((symbol) => forbiddenOrigin(symbol, tsNode, new Set(), 'tests'))) {
            report(node, 'outsideProduction', target)
          }
          return
        }
        for (const symbol of symbols) {
          const origin = forbiddenOrigin(symbol, tsNode)
          if (origin) report(node, kind === 'tests' ? 'test' : isClient(origin) ? 'transport' : 'endpoint', origin)
        }
      }

      function literalString(node) {
        return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null
      }
      function importMeta(node) {
        return ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword && node.name.text === 'meta'
      }
      function nativeConstructor(node, name, seen = new Set()) {
        while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) ||
               ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression
        const symbolNode = ts.isPropertyAccessExpression(node) ? node.name
          : ts.isElementAccessExpression(node) ? node.argumentExpression : node
        let symbol = checker.getSymbolAtLocation(symbolNode) ??
          (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)
            ? checker.getTypeAtLocation(node.expression).getProperty(node.argumentExpression.text) : undefined)
        if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
        if (!symbol || seen.has(symbol)) return false
        seen.add(symbol)
        return (symbol.declarations ?? []).some((declaration) => {
          if (declaration.name?.getText() === name &&
              /\/lib\.(?:dom|webworker)\.d\.ts$/.test(slash(declaration.getSourceFile().fileName))) return true
          return ts.isVariableDeclaration(declaration) && declaration.initializer &&
            declaration.parent.flags & ts.NodeFlags.Const &&
            nativeConstructor(declaration.initializer, name, seen)
        })
      }
      function loaderOptions(node, allowed) {
        const values = {}
        if (!node) return values
        if (!ts.isObjectLiteralExpression(node)) return null
        for (const property of node.properties) {
          if (!ts.isPropertyAssignment(property) ||
              !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) return null
          const name = property.name.text
          if (!allowed.includes(name) || Object.hasOwn(values, name)) return null
          const value = literalString(property.initializer) ??
            (property.initializer.kind === ts.SyntaxKind.TrueKeyword ? true
              : property.initializer.kind === ts.SyntaxKind.FalseKeyword ? false : null)
          if (value === null) return null
          values[name] = value
        }
        return values
      }
      const workerQueries = new Set(['?worker', '?worker&inline', '?worker&url', '?sharedworker', '?sharedworker&inline', '?sharedworker&url'])
      function globEdges(node) {
        const callee = node.expression
        const canonical = ts.isPropertyAccessExpression(callee) && importMeta(callee.expression) && callee.name.text === 'glob'
        const declaration = checker.getResolvedSignature(node)?.declaration
        const viteGlob = declaration && /\/vite\/types\/importGlob\.d\.ts$/.test(slash(declaration.getSourceFile().fileName))
        if (!canonical && !viteGlob) return null
        const fail = { error: 'unsupportedLoader' }
        if (!canonical || !viteGlob || node.arguments.length < 1 || node.arguments.length > 2) return fail
        const first = node.arguments[0]
        const patterns = ts.isArrayLiteralExpression(first) ? first.elements.map(literalString) : [literalString(first)]
        const options = loaderOptions(node.arguments[1], ['eager', 'exhaustive', 'import', 'query', 'as'])
        if (!patterns.length || patterns.some((pattern) => pattern === null) || !options ||
            ['eager', 'exhaustive'].some((key) => key in options && typeof options[key] !== 'boolean') ||
            ['import', 'query', 'as'].some((key) => key in options && typeof options[key] !== 'string') ||
            'as' in options && 'query' in options) return fail
        const query = options.as === undefined ? options.query ?? ''
          : ['raw', 'url', 'worker'].includes(options.as) ? `?${options.as}` : null
        if (query === null || !['', '?raw', '?url'].includes(query) && !workerQueries.has(query)) return fail
        const normalized = []
        const positives = []
        for (const pattern of patterns) {
          const negative = pattern.startsWith('!')
          const value = negative ? pattern.slice(1) : pattern
          if (!/^(?:\.{1,2}\/|\/)/.test(value) || value.startsWith('//') || value.includes('\\')) return fail
          const base = value.startsWith('/') ? root : path.dirname(filename)
          const suffix = value.startsWith('/') ? value.slice(1) : value
          const expanded = path.posix.join(glob.convertPathToPattern(base), suffix)
          normalized.push(`${negative ? '!' : ''}${expanded}`)
          if (!negative) positives.push({ expanded, value: path.resolve(base, suffix), dynamic: glob.isDynamicPattern(value) })
        }
        if (!positives.length) return fail
        // Absolute task entries need an absolute ignore as well as the
        // cwd-relative form. Normalize ../ before matching so dot:false cannot
        // make a literal parent segment defeat the node_modules exclusion.
        const packageIgnores = [
          '**/node_modules/**',
          path.posix.join(glob.convertPathToPattern(path.parse(root).root), '**/node_modules/**'),
        ]
        const globOptions = {
          cwd: root, absolute: true, onlyFiles: true, followSymbolicLinks: true,
          throwErrorOnBrokenSymbolicLink: true, suppressErrors: false,
          dot: options.exhaustive === true, ignore: options.exhaustive ? [] : packageIgnores,
        }
        try {
          const tasks = glob.generateTasks(positives.map((entry) => entry.expanded), globOptions)
          if (tasks.some((task) => !ts.sys.directoryExists(task.base)) ||
              positives.some((entry) => !entry.dynamic && !ts.sys.fileExists(entry.value))) return { error: 'unresolvedGlob' }
          const targets = glob.sync(normalized, globOptions).map((file) => path.resolve(file))
            .filter((file) => file !== path.resolve(filename))
          // Empty dynamic results are certified only after real expansion and
          // base checks; exclusion of all existing matches is also legitimate.
          return { targets, empty: targets.length === 0, data: query === '?raw' || query === '?url',
            importedName: options.import ?? null, executable: workerQueries.has(query) }
        } catch {
          return fail
        }
      }
      function workerEdges(node) {
        if (!nativeConstructor(node.expression, 'Worker')) return null
        const fail = { error: 'unsupportedLoader' }
        if (!node.arguments?.length || node.arguments.length > 2) return fail
        const options = loaderOptions(node.arguments[1], ['type', 'name', 'credentials'])
        if (!options || 'type' in options && !['module', 'classic'].includes(options.type) ||
            'name' in options && typeof options.name !== 'string' ||
            'credentials' in options && !['omit', 'include', 'same-origin'].includes(options.credentials)) return fail
        const url = node.arguments[0]
        if (!ts.isNewExpression(url) || !nativeConstructor(url.expression, 'URL') || url.arguments?.length !== 2 ||
            !ts.isPropertyAccessExpression(url.arguments[1]) || url.arguments[1].name.text !== 'url' ||
            !importMeta(url.arguments[1].expression)) return fail
        const value = literalString(url.arguments[0])
        if (value === null || !/^(?:\.{1,2}\/|\/)/.test(value) || value.startsWith('//') || value.includes('#')) return fail
        const queryAt = value.indexOf('?')
        const query = queryAt < 0 ? '' : value.slice(queryAt)
        // A Worker always loads executable code: raw/url markers cannot turn
        // its capability into a data exemption, including mixed worker queries.
        if (query && !workerQueries.has(query)) return fail
        const pathname = queryAt < 0 ? value : value.slice(0, queryAt)
        const target = path.resolve(value.startsWith('/') ? root : path.dirname(filename), value.startsWith('/') ? pathname.slice(1) : pathname)
        // Vite's Worker URL entry must exist as written: unlike ordinary TS
        // imports, a missing .js cannot borrow an existing .ts sibling.
        if (!ts.sys.fileExists(target)) return { error: 'unresolved', target: pathname }
        // A paired declaration can supply types, but cannot replace the real
        // executable path when checking a Worker's runtime boundary.
        return { targets: [target], data: false, importedName: null, executable: true, literalEntry: true }
      }
      function exportedGlobMap(call) {
        const file = call.getSourceFile()
        const moduleSymbol = checker.getSymbolAtLocation(file)
        if (!moduleSymbol) return false
        function symbolContains(symbol, seen) {
          if (!symbol || seen.has(symbol)) return false
          seen = new Set(seen).add(symbol)
          const declarations = symbol.declarations ?? []
          if (declarations.length && declarations.every((declaration) =>
            ts.isExportSpecifier(declaration) &&
            (declaration.isTypeOnly || declaration.parent.parent.isTypeOnly))) return false
          if (symbol.flags & ts.SymbolFlags.Alias) return symbolContains(checker.getAliasedSymbol(symbol), seen)
          return declarations.some((declaration) => {
            if (declaration.getSourceFile() !== file) return false
            if (ts.isExportAssignment(declaration)) return expressionContains(declaration.expression, seen)
            if (!ts.isVariableDeclaration(declaration) || !declaration.initializer ||
                declaration.parent.parent.parent !== file) return false
            // Follow only transparent immutable local bindings, not assignments,
            // function returns, or arbitrary expressions that consume the map.
            if (!(declaration.parent.flags & ts.NodeFlags.Const)) return false
            return expressionContains(declaration.initializer, seen)
          })
        }
        function expressionContains(expression, seen) {
          while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
                 ts.isTypeAssertionExpression(expression) || ts.isSatisfiesExpression(expression) ||
                 ts.isNonNullExpression(expression)) expression = expression.expression
          if (expression === call) return true
          if (ts.isIdentifier(expression)) return symbolContains(checker.getSymbolAtLocation(expression), seen)
          if (ts.isObjectLiteralExpression(expression)) {
            return expression.properties.some((property) => {
              if (ts.isShorthandPropertyAssignment(property)) {
                return symbolContains(checker.getShorthandAssignmentValueSymbol(property), seen)
              }
              if (ts.isPropertyAssignment(property)) return expressionContains(property.initializer, seen)
              if (ts.isSpreadAssignment(property)) return expressionContains(property.expression, seen)
              return false
            })
          }
          if (ts.isArrayLiteralExpression(expression)) {
            return expression.elements.some((element) =>
              expressionContains(ts.isSpreadElement(element) ? element.expression : element, seen))
          }
          return false
        }
        return checker.getExportsOfModule(moduleSymbol).some((symbol) => symbolContains(symbol, new Set()))
      }
      function inspectLoader(node, worker = false) {
        if (!production || !['resolution', 'feature', 'tests', 'seam'].includes(kind)) return
        const tsNode = services.esTreeNodeToTSNodeMap.get(node)
        let entries = expandedEdgesCache.get(program)
        if (!entries) expandedEdgesCache.set(program, entries = new WeakMap())
        let result = entries.get(tsNode)
        if (!entries.has(tsNode)) {
          result = worker ? workerEdges(tsNode) : globEdges(tsNode)
          entries.set(tsNode, result)
        }
        if (!result) return
        if (result.error) {
          if (kind === 'resolution') report(node, result.error, result.target ?? '')
          return
        }
        if (result.data) return
        const exporting = !worker && kind === 'seam' && isBarrel(source) && exportedGlobMap(tsNode)
        for (const target of result.targets) inspect(node, { value: slash(target) }, exporting, true,
          result.importedName, result.executable, result.literalEntry ? target : null)
      }

      return {
        Program(node) {
          if (kind !== 'names' || !facts) return
          // These two exact composition roots were inspected; the exemption
          // also requires their actual ReactDOM/router declaration evidence.
          if ((source === 'src/main.tsx' && facts.bootstrap) ||
              (source === 'src/router.tsx' && facts.routeComposition)) return
          const basename = path.basename(source)
          if (facts.opaqueComponent) report(node, 'opaqueComponent')
          if (facts.hookRendering || (!facts.rendering && (facts.opaqueReact || (facts.unknownHooks && facts.hooks.size === 0)))) {
            report(node, 'ambiguousRole')
          } else if (facts.rendering) {
            if (!componentLocation(source)) report(node, 'componentPlacement')
            if (/(?:^|\/)pages\//.test(source)) {
              if (!/^[A-Z][A-Za-z0-9]*Page\.tsx$/.test(basename)) report(node, 'pageName')
            } else if (!/^[A-Z][A-Za-z0-9]*\.tsx$/.test(basename)) report(node, 'componentName')
          } else if (facts.hooks.size) {
            if (!hookLocation(source)) report(node, 'hookPlacement')
            if ([...facts.hooks].some((name) => /^[A-Z]/.test(name))) report(node, 'ambiguousRole')
            else if (!/^use[A-Z0-9][A-Za-z0-9]*\.tsx?$/.test(basename) ||
                     [...facts.hooks].some((name) => !hookName(name))) report(node, 'hookName')
          }
        },
        ImportDeclaration(node) { inspect(node, node.source) },
        ExportNamedDeclaration(node) {
          if (node.source) inspect(node, node.source, true)
          else if (kind === 'seam' && production && isBarrel(source)) {
            for (const specifier of node.specifiers) {
              const tsNode = services.esTreeNodeToTSNodeMap.get(specifier)
              const origin = forbiddenOrigin(checker.getSymbolAtLocation(tsNode.name), tsNode)
              if (origin) report(node, isClient(origin) ? 'transport' : 'endpoint', origin)
            }
          }
        },
        ExportAllDeclaration(node) { inspect(node, node.source, true) },
        ExportDefaultDeclaration(node) {
          if (kind !== 'seam' || !production || !isBarrel(source)) return
          const tsNode = services.esTreeNodeToTSNodeMap.get(node)
          const moduleSymbol = checker.getSymbolAtLocation(tsNode.getSourceFile())
          const exported = moduleSymbol && checker.getExportsOfModule(moduleSymbol).find((symbol) => symbol.name === 'default')
          const origin = forbiddenOrigin(exported, tsNode)
          if (origin) report(node, isClient(origin) ? 'transport' : 'endpoint', origin)
        },
        ImportExpression(node) { inspect(node, node.source) },
        TSImportType(node) { inspect(node, node.source) },
        TSImportEqualsDeclaration(node) {
          if (node.moduleReference.type === 'TSExternalModuleReference') inspect(node, node.moduleReference.expression)
        },
        Identifier(node) {
          if (valueReferences.has(node)) checkFetchReference(node)
        },
        VariableDeclarator(node) {
          if (!enforceFetch || node.id.type !== 'ObjectPattern' || !node.init) return
          const type = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node.init))
          for (const property of node.id.properties) {
            if (property.type !== 'Property') continue
            const name = property.computed ? property.key.value : property.key.name ?? property.key.value
            if (property.computed && typeof name !== 'string') {
              if (nativeFetchSymbol(type.getProperty('fetch'))) report(property, 'escapedFetch')
              continue
            }
            if (typeof name !== 'string' || !nativeFetchSymbol(type.getProperty(name))) continue
            if (property.value.type !== 'Identifier' || node.parent.kind !== 'const' ||
                node.parent.parent?.type === 'ExportNamedDeclaration' || !preservesNativeSignature(property.value)) report(property, 'escapedFetch')
          }
        },
        MemberExpression(node) {
          checkFetchReference(node)
          if (kind !== 'seam' || !ui) return
          const tsNode = services.esTreeNodeToTSNodeMap.get(node)
          if (ts.isElementAccessExpression(tsNode) && !ts.isStringLiteral(tsNode.argumentExpression)) {
            const owner = checker.getTypeAtLocation(tsNode.expression).symbol
            if (owner?.declarations?.some((entry) => isClient(relative(entry.getSourceFile().fileName)))) report(node, 'transport')
          }
          const symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(tsNode) ? tsNode.name : tsNode.argumentExpression)
          const origin = forbiddenOrigin(symbol, tsNode)
          if (origin) report(node, isClient(origin) ? 'transport' : 'endpoint', origin)
        },
        CallExpression(node) {
          inspectLoader(node)
          if (node.callee.type === 'Identifier' && node.callee.name === 'require') inspect(node, node.arguments[0])
          if (kind !== 'seam') return
          const tsCallee = services.esTreeNodeToTSNodeMap.get(node.callee)
          if (ui) {
            const symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(tsCallee) ? tsCallee.name : tsCallee)
            const origin = forbiddenOrigin(symbol, tsCallee)
            if (origin) report(node, isClient(origin) ? 'transport' : 'endpoint', origin)
          }
          if (!enforceFetch) return
          const operation = fetchOperation(node.callee)
          if (operation === 'bind') report(node, 'escapedFetch')
          else if (operation === 'call') checkFetchUrl(node, node.arguments[1])
          else if (operation === 'apply') {
            const argumentsList = node.arguments[1]
            checkFetchUrl(node, argumentsList?.type === 'ArrayExpression' ? argumentsList.elements[0] : null)
          } else if (nativeFetchValue(tsCallee)) checkFetchUrl(node, node.arguments[0])
        },
        NewExpression(node) { inspectLoader(node, true) },
      }
    },
  }
}

export default {
  rules: {
    'wire-dto-ownership': wireOwnershipRule,
    'feature-public-api': createBoundaryRule('feature'),
    'ui-service-boundary': createBoundaryRule('seam'),
    'no-production-test-imports': createBoundaryRule('tests'),
    'resolvable-imports': createBoundaryRule('resolution'),
    'ui-role-names': createBoundaryRule('names'),
  },
}
