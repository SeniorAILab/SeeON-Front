import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ESLint } from 'eslint'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const configFile = path.resolve(process.cwd(), 'eslint.config.js')
const cases = [
  ['alias deep feature', 'src/pages/Alias.ts', 'export { internal } from "@/features/alpha/internal"', 'feature-public-api'],
  ['relative deep feature', 'src/pages/Relative.ts', 'export { internal } from "../features/alpha/internal"', 'feature-public-api'],
  ['extension substitution', 'src/pages/Extension.ts', 'export { internal } from "../features/alpha/internal.js"', 'feature-public-api'],
  ['renamed internal entry', 'src/pages/Renamed.ts', 'export { internal } from "@/features/alpha/public"', 'feature-public-api'],
  ['dynamic deep feature', 'src/pages/Dynamic.ts', 'export const load = () => import("@/features/alpha/internal")', 'feature-public-api'],
  ['namespace deep feature', 'src/pages/Namespace.ts', 'import * as hidden from "@/features/alpha/internal"; export const value = hidden.internal', 'feature-public-api'],
  ['default deep feature', 'src/pages/Default.ts', 'import renamed from "@/features/alpha/internal"; export const value = renamed', 'feature-public-api'],
  ['type-only deep feature', 'src/pages/TypeOnly.ts', 'export type Value = import("@/features/alpha/internal").Value', 'feature-public-api'],
  ['cross-feature deep import', 'src/features/beta/components/Cross.ts', 'export { internal } from "../../alpha/internal"', 'feature-public-api'],
  ['endpoint alias', 'src/pages/Endpoint.ts', 'export { getRecord } from "@/services/api/records"', 'ui-service-boundary'],
  ['endpoint renamed hook import', 'src/features/beta/hooks/Endpoint.ts', 'import { getRecord as load } from "@/services/api/records"; export const useRecord = load', 'ui-service-boundary'],
  ['endpoint relative feature hook', 'src/features/beta/hooks/RelativeEndpoint.ts', 'export { getRecord } from "../../../services/api/records"', 'ui-service-boundary'],
  ['endpoint feature page', 'src/features/beta/pages/Endpoint.ts', 'export { getRecord } from "@/services/api/records"', 'ui-service-boundary'],
  ['endpoint dynamic', 'src/features/beta/components/Endpoint.ts', 'export const load = () => import("@/services/api/records")', 'ui-service-boundary'],
  ['endpoint renamed extension', 'src/components/Renamed.jsx', 'export { getRecord } from "../services/api/records.js"', 'ui-service-boundary'],
  ['wire type through barrel', 'src/pages/Wire.ts', 'export type { WireRecord } from "@/features/leak"', 'ui-service-boundary'],
  ['endpoint through barrel', 'src/pages/Leak.ts', 'import { renamed } from "@/features/leak"; export const value = renamed', 'ui-service-boundary'],
  ['namespace through barrel', 'src/pages/LeakNamespace.ts', 'import * as alias from "@/features/leak"; export const value = alias.renamed', 'ui-service-boundary'],
  ['default through barrel', 'src/pages/LeakDefault.ts', 'import api from "@/features/defaultLeak"; export const value = api.getRecord', 'ui-service-boundary'],
  ['feature barrel reexport', 'src/features/exportLeak/index.ts', 'export * from "@/services/api/records"', 'ui-service-boundary'],
  ['feature barrel local export', 'src/features/localLeak/index.ts', 'import { getRecord } from "@/services/api/records"; export { getRecord }', 'ui-service-boundary'],
  ['feature barrel default object', 'src/features/objectLeak/index.ts', 'import { getRecord } from "@/services/api/records"; export default { getRecord }', 'ui-service-boundary'],
  ['renamed backend transport', 'src/components/Request.ts', 'import { requestJson as call } from "@/services/apiClient"; export const run = () => call("/x")', 'ui-service-boundary'],
  ['namespace backend transport', 'src/hooks/Request.ts', 'import * as client from "@/services/apiClient"; export const run = () => client.requestJson("/x")', 'ui-service-boundary'],
  ['destructured backend namespace', 'src/hooks/DestructuredRequest.ts', 'import * as client from "@/services/apiClient"; const { requestJson: load } = client; export const run = () => load("/x")', 'ui-service-boundary'],
  ['computed backend namespace', 'src/hooks/ComputedRequest.ts', 'import * as client from "@/services/apiClient"; export const run = (name: keyof typeof client) => client[name]', 'ui-service-boundary'],
  ['namespace export of endpoints', 'src/features/namespaceLeak/index.ts', 'export * as backend from "@/services/api/records"', 'ui-service-boundary'],
  ['CommonJS endpoint load', 'src/components/CommonJS.cts', 'const backend = require("../services/api/records"); export const run = backend.getRecord', 'ui-service-boundary'],
  ['backend fetch', 'src/pages/Fetch.ts', 'export const load = () => fetch("/api/v1/records")', 'ui-service-boundary'],
  ['renamed fetch alias', 'src/pages/FetchAlias.ts', 'const transport = fetch; export const load = () => transport("/api/v1/records")', 'ui-service-boundary', 'fetch'],
  ['window backend fetch', 'src/pages/WindowFetch.ts', 'export const load = () => window.fetch("https://api.example.test/api/v1/records")', 'ui-service-boundary'],
  ['unclassifiable backend fetch', 'src/hooks/Fetch.ts', 'export const load = (url: string) => fetch(url)', 'ui-service-boundary'],
  ['production imports tests', 'src/pages/TestImport.ts', 'export { fixture } from "@/features/alpha/internal.test"', 'no-production-test-imports'],
  ['production imports test directory', 'src/pages/TestDirectory.ts', 'export { fixture } from "../test/fixture"', 'no-production-test-imports'],
  ['production imports tests through barrel', 'src/pages/TestBarrel.ts', 'export { fixture } from "@/features/testLeak"', 'no-production-test-imports'],
  ['missing local target', 'src/pages/Missing.ts', 'export { absent } from "@/missing"', 'resolvable-imports'],
  ['computed module import', 'src/pages/Computed.ts', 'export const load = (module: string) => import(module)', 'resolvable-imports'],
  ['public feature API', 'src/pages/Public.ts', 'export { internal } from "@/features/alpha"', null],
  ['public feature default component', 'src/pages/PublicDefault.ts', 'import Screen from "@/features/screen"; export const render = Screen', null],
  ['self-feature internal', 'src/features/alpha/components/Self.ts', 'export { internal } from "../internal"', null],
  ['test deep import', 'src/pages/Deep.test.ts', 'export { internal } from "@/features/alpha/internal"', null],
  ['test endpoint import', 'src/pages/Endpoint.spec.ts', 'export { getRecord } from "@/services/api/records"', null],
  ['test-directory deep import', 'src/test/Deep.ts', 'export { internal } from "@/features/alpha/internal"', null],
  ['service facade UI', 'src/components/Facade.ts', 'import { recordService } from "@/services/recordService"; export const run = recordService.getRecord', null],
  ['service facade endpoint dependency', 'src/services/Other.ts', 'import { getRecord } from "./api/records"; export const otherService = { getRecord }', null],
  ['service facade feature export', 'src/features/facade/index.ts', 'export { recordService } from "@/services/recordService"', null],
  ['pure api error helper', 'src/hooks/Error.ts', 'import { apiErrorMessage as message } from "@/services/apiClient"; export const useMessage = message', null],
  ['namespaced pure api error helper', 'src/hooks/NamespaceError.ts', 'import * as client from "@/services/apiClient"; export const useMessage = () => client.apiErrorMessage()', null],
  ['domain type not suffix banned', 'src/pages/Domain.ts', 'export type { UsefulDTO } from "@/types"', null],
  ['validated media view reexports', 'src/pages/MediaView.ts', 'export type { AlertMediaMetadata, ReadyAlertMediaClip, AlertMediaAccessAction } from "@/services/alertService"', null],
  ['wire renamed as media view', 'src/pages/FakeMediaView.ts', 'export type { AlertMediaMetadata } from "@/features/fakeMedia"', 'ui-service-boundary'],
  ['domain media error identity', 'src/pages/MediaError.ts', 'export { AlertMediaDownloadError } from "@/services/alertService"; export type { AlertMediaDownloadErrorCode } from "@/services/alertService"', null],
  ['static asset fetch', 'src/components/Asset.ts', 'export const load = () => fetch("/icon.svg")', null],
  ['shadowed fetch function', 'src/components/Shadow.ts', 'const fetch = (value: string) => value; export const run = () => fetch("/api/label")', null],
  ['unsafe service assignment', 'src/services/UnsafeAssignment.ts', 'declare const body: any; export const value: string = body', '@typescript-eslint/no-unsafe-assignment'],
  ['unsafe service argument', 'src/services/UnsafeArgument.ts', 'declare const body: any; const take = (value: string) => value; export const run = () => take(body)', '@typescript-eslint/no-unsafe-argument'],
  ['unsafe service call', 'src/services/UnsafeCall.ts', 'declare const call: any; export const run = () => call()', '@typescript-eslint/no-unsafe-call'],
  ['unsafe service member', 'src/services/UnsafeMember.ts', 'declare const body: any; export const value = body.id', '@typescript-eslint/no-unsafe-member-access'],
  ['unsafe service return', 'src/services/UnsafeReturn.ts', 'declare const body: any; export const run = () => body', '@typescript-eslint/no-unsafe-return'],
  ['JSX moved outside UI folders retains seam', 'src/lib/LeakedView.tsx', 'import { getRecord } from "@/services/api/records"; export function LeakedView() { getRecord(); return <div /> }', 'ui-service-boundary'],
  ['renamed JSX component', 'src/lib/renamed.tsx', 'export function View() { return <div /> }', 'ui-role-names'],
  ['JSX extension bypass', 'src/lib/View.jsx', 'export function View() { return <div /> }', 'ui-role-names'],
  ['rendering page needs Page suffix', 'src/pages/Settings.tsx', 'export function Settings() { return <div /> }', 'ui-role-names'],
  ['rendering feature page convention', 'src/features/role/pages/SettingsPage.tsx', 'export function SettingsPage() { return <div /> }', null],
  ['ordinary component using hooks', 'src/features/role/components/Counter.tsx', 'import { useState } from "react"; export function Counter() { const [count] = useState(0); return <div>{count}</div> }', null],
  ['normal feature hook convention', 'src/features/role/hooks/useCounter.ts', 'import { useState } from "react"; export function useCounter() { return useState(0) }', null],
  ['aliased React hook renamed module', 'src/lib/counter.ts', 'import { useState as state } from "react"; export function useCounter() { return state(0) }', 'ui-role-names'],
  ['namespaced hook relocated seam', 'src/lib/useLeakedCounter.ts', 'import * as R from "react"; import { getRecord } from "@/services/api/records"; export function useLeakedCounter() { const state = R.useState(0); getRecord(); return state }', 'ui-service-boundary'],
  ['wrong hook callable name', 'src/lib/useWrong.ts', 'import { useState } from "react"; export function calculate() { return useState(0) }', 'ui-role-names'],
  ['aliased React hook valid module', 'src/hooks/useAliased.ts', 'import { useState as state } from "react"; export function useAliased() { return state(0) }', null],
  ['React factory requires TSX component file', 'src/lib/Factory.ts', 'import { createElement as element } from "react"; export function Factory() { return element("div") }', 'ui-role-names', 'componentName'],
  ['React namespace factory relocated seam', 'src/lib/FactoryView.tsx', 'import * as R from "react"; import { getRecord } from "@/services/api/records"; export function FactoryView() { getRecord(); return R.createElement("div") }', 'ui-service-boundary'],
  ['React local factory alias', 'src/lib/factoryAlias.ts', 'import { createElement } from "react"; const element = createElement; export function View() { return element("div") }', 'ui-role-names'],
  ['non-React factory spelling is pure', 'src/lib/localElementFactory.ts', 'function createElement(value: string) { return value }; export const text = createElement("div")', null],
  ['typed null-render component with hooks', 'src/components/NullPanel.tsx', 'import { type FC, useState } from "react"; export const NullPanel: FC = () => { useState(0); return null }', null],
  ['typed null-render component renamed', 'src/lib/nullPanel.ts', 'import type { FC as Component } from "react"; export const Panel: Component = () => null', 'ui-role-names'],
  ['ambiguous null-render hook caller', 'src/lib/Unclassified.tsx', 'import { useState } from "react"; export function Unclassified() { useState(0); return null }', 'ui-role-names'],
  ['hook returning JSX is explicitly ambiguous', 'src/lib/useView.tsx', 'import { useState } from "react"; export function useView() { useState(0); return <div /> }', 'ui-role-names'],
  ['opaque custom hook wrapper is diagnostic', 'src/lib/useWrapped.ts', 'import { useCounter as counter } from "@/features/role/hooks/useCounter"; export function useWrapped() { return counter() }', 'ui-role-names'],
  ['React router hook convention', 'src/hooks/useRoute.ts', 'import { useLocation as location } from "react-router-dom"; export function useRoute() { return location() }', null],
  ['React class component renamed', 'src/lib/classView.tsx', 'import { Component as Base } from "react"; export class View extends Base { render() { return null } }', 'ui-role-names'],
  ['actual bootstrap composition root', 'src/main.tsx', 'import React from "react"; import ReactDOM from "react-dom/client"; ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><div /></React.StrictMode>)', null],
  ['actual router composition root', 'src/router.tsx', 'import { createBrowserRouter } from "react-router-dom"; const auth = () => <div />; export const router = createBrowserRouter([{ path: "/", element: auth() }])', null],
  ['bootstrap exemption is exact path', 'src/lib/bootstrap.tsx', 'import { createRoot } from "react-dom/client"; createRoot(document.getElementById("root")!).render(<div />)', 'ui-role-names'],
  ['root composition never exempts backend seam', 'src/lib/BackendBootstrap.tsx', 'import { createRoot } from "react-dom/client"; import { getRecord } from "@/services/api/records"; getRecord(); createRoot(document.getElementById("root")!).render(null)', 'ui-service-boundary'],
  ['rendering test keeps test-only deep imports', 'src/lib/render.test.tsx', 'import { internal } from "@/features/alpha/internal"; import { getRecord } from "@/services/api/records"; export const view = <div>{internal}{String(getRecord)}</div>', null],
  ['pure page helper keeps ordinary name', 'src/pages/formatLabel.ts', 'export function formatLabel(value: string) { return value.trim() }', null],
  ['type-only React helper is not component', 'src/lib/reactTypes.ts', 'import type { FC } from "react"; export type View = FC', null],
  ['computed React callable is explicit diagnostic', 'src/lib/invokeReact.ts', 'import * as R from "react"; export function invokeReact(key: "createElement" | "cloneElement") { return R[key]("div") }', 'ui-role-names'],
  ['React predicate remains pure helper', 'src/lib/isElement.ts', 'import { isValidElement } from "react"; export const isElement = (value: unknown) => isValidElement(value)', null],
  ['valid React factory component', 'src/components/FactoryPanel.tsx', 'import { createElement as element } from "react"; export function FactoryPanel() { return element("div") }', null],
  ['Zustand bound-store custom hook', 'src/hooks/useBoundCount.ts', 'import { useCountStore } from "@/stores/countStore"; export function useBoundCount() { return useCountStore(state => state.count) }', null],
  ['Zustand import alias custom hook', 'src/hooks/useAliasedCount.ts', 'import { useCountStore as select } from "@/stores/countStore"; export function useAliasedCount() { return select(state => state.count) }', null],
  ['Zustand namespace custom hook', 'src/hooks/useNamespaceCount.ts', 'import * as stores from "@/stores/countStore"; export function useNamespaceCount() { return stores.useCountStore(state => state.count) }', null],
  ['Zustand local callable alias', 'src/hooks/useLocalCount.ts', 'import { useCountStore } from "@/stores/countStore"; const select = useCountStore; export function useLocalCount() { return select() }', null],
  ['Zustand component hook usage', 'src/components/CountPanel.tsx', 'import { useCountStore } from "@/stores/countStore"; export function CountPanel() { const count = useCountStore(state => state.count); return <div>{count}</div> }', null],
  ['Zustand moved hook still enforces filename', 'src/lib/countHelper.ts', 'import { useCountStore as select } from "@/stores/countStore"; export function useCount() { return select(state => state.count) }', 'ui-role-names'],
  ['Zustand moved hook still enforces callable name', 'src/lib/useCountHelper.ts', 'import { useCountStore as select } from "@/stores/countStore"; export function readCount() { return select(state => state.count) }', 'ui-role-names'],
  ['Zustand renamed callable still activates service seam', 'src/lib/useEndpointCount.ts', 'import { useCountStore as select } from "@/stores/countStore"; import { getRecord } from "@/services/api/records"; export function useEndpointCount() { getRecord(); return select(state => state.count) }', 'ui-service-boundary'],
  ['Zustand namespace still activates service seam', 'src/lib/useNamespaceEndpoint.ts', 'import * as stores from "@/stores/countStore"; import { getRecord } from "@/services/api/records"; export function useNamespaceEndpoint() { getRecord(); return stores.useCountStore() }', 'ui-service-boundary'],
  ['Zustand bound store creation is not a hook call', 'src/stores/creation.ts', 'import { create } from "zustand"; export const useCreatedStore = create<{ count: number }>()(() => ({ count: 0 }))', null],
  ['Zustand getState remains ordinary helper', 'src/lib/readCount.ts', 'import { useCountStore } from "@/stores/countStore"; export function readCount() { return useCountStore.getState().count }', null],
  ['Zustand vanilla creation and getState remain ordinary helpers', 'src/lib/vanillaCount.ts', 'import { createStore } from "zustand/vanilla"; const store = createStore(() => ({ count: 0 })); export function readCount() { return store.getState().count }', null],
  ['Zustand vanilla mutation and subscription are not render hooks', 'src/lib/vanillaObserver.ts', 'import { createStore } from "zustand/vanilla"; const store = createStore(() => ({ count: 0 })); export function observe() { store.setState({ count: 1 }); return store.subscribe(() => {}) }', null],
  ['local UseBoundStore type is not official React hook evidence', 'src/lib/fakeBound.ts', 'type UseBoundStore = { (): number }; const select: UseBoundStore = () => 1; export function readCount() { return select() }', null],
  ['same-named local type cannot clear unknown hook diagnostic', 'src/lib/useFakeBound.ts', 'type UseBoundStore = { (): number }; const useFake: UseBoundStore = () => 1; export function useFakeBound() { return useFake() }', 'ui-role-names'],
  ['protocol-relative API query cannot impersonate asset', 'src/lib/protocolTransport.ts', 'export const load = () => fetch("//api.example.test/api/v1/auth/me?x=.svg")', 'ui-service-boundary'],
  ['non-asset query suffix cannot impersonate asset', 'src/lib/queryTransport.ts', 'export const load = () => fetch("/private/session?image=.svg")', 'ui-service-boundary'],
  ['relative dot segments normalize before API classification', 'src/lib/dotTransport.ts', 'export const load = () => fetch("./assets/../api/v1/auth/me?x=.svg")', 'ui-service-boundary'],
  ['backslash URL normalizes before API classification', 'src/lib/backslashTransport.ts', `export const load = () => fetch(${JSON.stringify(String.raw`\\api.example.test\api\v1\auth\me?x=.svg`)})`, 'ui-service-boundary'],
  ['encoded API pathname is not an asset', 'src/lib/encodedTransport.ts', 'export const load = () => fetch("/%61pi/v1/private.svg")', 'ui-service-boundary'],
  ['renamed pure helper cannot own backend fetch', 'src/lib/pureTransport.ts', 'export function retrieve() { return globalThis.fetch("/api/v1/auth/me") }', 'ui-service-boundary'],
  ['ordinary service cannot own backend fetch', 'src/services/nativeTransport.ts', 'export const retrieve = () => fetch("/api/v1/auth/me")', 'ui-service-boundary'],
  ['endpoint mapper cannot bypass sole native fetch owner', 'src/services/api/nativeTransport.ts', 'export const retrieve = () => fetch("/api/v1/auth/me")', 'ui-service-boundary'],
  ['native fetch call backend', 'src/lib/callTransport.ts', 'export const retrieve = () => fetch.call(globalThis, "/api/v1/auth/me")', 'ui-service-boundary'],
  ['native fetch apply backend', 'src/lib/applyTransport.ts', 'export const retrieve = () => window.fetch.apply(window, ["/api/v1/auth/me"])', 'ui-service-boundary'],
  ['native fetch bound capability', 'src/lib/boundTransport.ts', 'const retrieve = fetch.bind(globalThis); export const load = () => retrieve("/api/v1/auth/me")', 'ui-service-boundary'],
  ['native fetch typed callback escape', 'src/lib/callbackTransport.ts', 'const forward = (fn: (url: string) => Promise<Response>) => fn("/api/v1/auth/me"); export const load = () => forward(fetch)', 'ui-service-boundary'],
  ['type-erased native fetch alias', 'src/lib/erasedTransport.ts', 'const retrieve: (url: string) => Promise<Response> = fetch; export const load = () => retrieve("/api/v1/auth/me")', 'ui-service-boundary'],
  ['assertion-erased native fetch alias', 'src/lib/assertedTransport.ts', 'const retrieve = fetch as unknown as (url: string) => Promise<Response>; export const load = () => retrieve("/api/v1/auth/me")', 'ui-service-boundary'],
  ['exported native fetch capability', 'src/lib/exportTransport.ts', 'export const retrieve = fetch', 'ui-service-boundary'],
  ['native method capability escape', 'src/lib/methodTransport.ts', 'const invoke = fetch.call; export const load = () => invoke(fetch, globalThis, "/api/v1/auth/me")', 'ui-service-boundary'],
  ['dynamic apply arguments fail closed', 'src/lib/dynamicApply.ts', 'export const load = (args: [string]) => fetch.apply(globalThis, args)', 'ui-service-boundary'],
  ['pure helper dynamic native URL fails closed', 'src/lib/dynamicTransport.ts', 'export const load = (url: string) => fetch(url)', 'ui-service-boundary'],
  ['real asset pathname with query remains allowed', 'src/lib/assetQuery.ts', 'export const load = () => fetch("//cdn.example.test/icons/check.svg?token=abc&redirect=/api/v1/me")', null],
  ['relative asset dot segments remain allowed', 'src/lib/assetDots.ts', 'export const load = () => fetch("./images/../icons/check.svg?v=1")', null],
  ['static template asset remains allowed', 'src/lib/templateAsset.ts', 'export const load = () => fetch(`/icons/check.svg?v=1`)', null],
  ['data and blob fetch remain allowed', 'src/lib/localResources.ts', 'export const inline = () => fetch("data:text/plain,hello"); export const blob = () => fetch("blob:https://example.test/resource-id")', null],
  ['known native aliases can load static assets', 'src/lib/aliasAssets.ts', 'const first = fetch; const second = first; export const load = () => second("/icons/check.svg?v=1")', null],
  ['known native destructuring alias can load assets', 'src/lib/destructuredAssets.ts', 'const { fetch: retrieve } = window; export const load = () => retrieve("/icons/check.svg?v=1")', null],
  ['native call with static asset remains allowed', 'src/lib/callAsset.ts', 'export const load = () => fetch.call(globalThis, "/icons/check.svg?v=1")', null],
  ['native apply with static asset remains allowed', 'src/lib/applyAsset.ts', 'export const load = () => fetch.apply(globalThis, ["/icons/check.svg?v=1"])', null],
  ['local call apply bind lookalikes are not native fetch', 'src/lib/localTransport.ts', 'const fetch = (value: string) => value; export const a = () => fetch.call(null, "/api/v1/me"); export const b = () => fetch.apply(null, ["/api/v1/me"]); export const c = fetch.bind(null)', null],
  ['structurally typed local implementation is not native fetch', 'src/lib/localTypedTransport.ts', 'const fetch: typeof globalThis.fetch = async () => new Response(); export const load = () => fetch("/api/v1/me")', null],
  ['native fetch availability check is not capability escape', 'src/lib/fetchAvailable.ts', 'export const available = typeof fetch === "function"', null],
  ['store endpoint imports retain existing scope policy', 'src/stores/apiConsumer.ts', 'import { getRecord } from "@/services/api/records"; export const load = getRecord', null],
  ['actual apiClient owns native backend transport', 'src/services/apiClient.ts', 'export const requestJson = async (url: string) => url; export const apiErrorMessage = () => "error"; export const nativeTransport = (url: string) => fetch(url)', null],
  ['type-erased destructuring capability fails closed', 'src/lib/erasedDestructure.ts', 'const { fetch: retrieve }: { fetch: (url: string) => Promise<Response> } = window; export const load = () => retrieve("/api/v1/me")', 'ui-service-boundary'],
  ['computed native destructuring retains asset alias support', 'src/lib/computedAssetAlias.ts', 'const { ["fetch"]: retrieve } = window; export const load = () => retrieve("/icons/check.svg?v=1")', null],
  ['same-signature native alias remains supported', 'src/lib/typedAssetAlias.ts', 'const retrieve: typeof fetch = fetch; export const load = () => retrieve("/icons/check.svg?v=1")', null],
  ['PascalCase renderer still requires component placement', 'src/lib/MisplacedPanel.tsx', 'export const MisplacedPanel = () => <div />', 'ui-role-names', 'componentPlacement'],
  ['correctly named hook still requires hook placement', 'src/lib/useMisplaced.ts', 'import { useState } from "react"; export function useMisplaced() { return useState(0) }', 'ui-role-names', 'hookPlacement'],
  ['component directory does not permit hook-only modules', 'src/components/useMisplaced.ts', 'import { useState } from "react"; export function useMisplaced() { return useState(0) }', 'ui-role-names', 'hookPlacement'],
  ['hook directory does not permit component modules', 'src/hooks/MisplacedPanel.tsx', 'export const MisplacedPanel = () => <div />', 'ui-role-names', 'componentPlacement'],
  ['registered imported null renderer owns its source', 'src/lib/NullRenderer.tsx', 'export function NullRenderer() { return null }', 'ui-role-names', 'componentPlacement'],
  ['registered imported string renderer owns its source', 'src/lib/StringRenderer.tsx', 'export const StringRenderer = () => "rendered"', 'ui-role-names', 'componentPlacement'],
  ['registered default arrow renderer owns its source', 'src/lib/DefaultRenderer.tsx', 'export default () => null', 'ui-role-names', 'componentPlacement'],
  ['real aliased factory registration owns null renderer', 'src/lib/FactoryRenderer.tsx', 'export function FactoryRenderer() { return null }', 'ui-role-names', 'componentPlacement'],
  ['registered renderer cannot hide backend imports', 'src/lib/RegisteredBackend.tsx', 'import { getRecord } from "@/services/api/records"; export function RegisteredBackend() { getRecord(); return null }', 'ui-service-boundary', 'endpoint'],
  ['registered component in shared directory is valid', 'src/components/RegisteredPanel.tsx', 'export function RegisteredPanel() { return null }', null],
  ['registered feature component is valid', 'src/features/registered/components/TextPanel.tsx', 'export const TextPanel = () => "text"', null],
  ['registered page still requires page filename', 'src/pages/RegisteredScreen.tsx', 'export function RegisteredScreen() { return null }', 'ui-role-names', 'pageName'],
  ['registered page in page directory is valid', 'src/pages/RegisteredPage.tsx', 'export function RegisteredPage() { return null }', null],
  ['pure null and string helpers are not component definitions', 'src/lib/nullAndString.ts', 'export function maybeValue() { return null }; export function label() { return "label" }', null],
  ['fake React factory does not establish helper role', 'src/lib/fakeFactoryTarget.ts', 'export function textValue() { return "text" }', null],
  ['props interface is not attributed component ownership', 'src/lib/registrationProps.ts', 'export interface RegistrationProps { label: string }', null],
  ['foreign component reexport is not owned definition', 'src/lib/foreignComponent.ts', 'export { StrictMode } from "react"', null],
  ['test-only registration does not reclassify pure helper', 'src/lib/testOnlyNull.ts', 'export function testOnlyNull() { return null }', null],
  ['opaque runtime registration is diagnostic', 'src/lib/OpaqueRenderer.tsx', 'declare const choose: () => () => null; export const OpaqueRenderer = choose()', 'ui-role-names', 'opaqueComponent'],
  ['installed Lucide conditional and local picker are foreign components', 'src/components/LibraryIconSelection.tsx', 'import { AlertTriangle, CheckCircle2, HelpCircle, ShieldCheck, VideoOff } from "lucide-react"; function iconFor(level: string) { if (level === "DANGER") return AlertTriangle; if (level === "CHECK_NEEDED") return HelpCircle; if (level === "CAUTION") return ShieldCheck; return CheckCircle2 }; export function LibraryIconSelection({ disconnected, level }: { disconnected: boolean; level: string }) { const Icon = disconnected ? VideoOff : iconFor(level); return <Icon /> }', null],
  ['foreign component picker remains a pure helper', 'src/lib/libraryIconPicker.ts', 'import { VideoOff, CheckCircle2 } from "lucide-react"; export function selectIcon(disconnected: boolean) { return disconnected ? VideoOff : CheckCircle2 }', null],
  ['imported library picker is not component ownership', 'src/components/LibraryPickerConsumer.tsx', 'import { selectIcon as pick } from "@/lib/libraryIconPicker"; export function LibraryPickerConsumer() { const Icon = pick(true); return <Icon /> }', null],
  ['actual React factory accepts certified foreign picker result', 'src/components/LibraryFactoryConsumer.tsx', 'import { createElement } from "react"; import { selectIcon } from "@/lib/libraryIconPicker"; export function LibraryFactoryConsumer() { return createElement(selectIcon(false)) }', null],
  ['own renderer in mixed conditional retains source ownership', 'src/lib/OwnSelectedRenderer.tsx', 'export const OwnSelectedRenderer = () => null', 'ui-role-names', 'componentPlacement'],
  ['mixed selection does not misattribute consumer ownership', 'src/components/MixedIconSelection.tsx', 'import { VideoOff } from "lucide-react"; import { OwnSelectedRenderer } from "@/lib/OwnSelectedRenderer"; export function MixedIconSelection({ disconnected }: { disconnected: boolean }) { const Icon = disconnected ? VideoOff : OwnSelectedRenderer; return <Icon /> }', null],
  ['local same-named component type cannot prove foreign picker provenance', 'src/components/LocalPickerLookalike.tsx', 'type LucideIcon = () => null; function selectIcon(): LucideIcon { return () => null }; export function LocalPickerLookalike() { const Icon = selectIcon(); return <Icon /> }', 'ui-role-names', 'opaqueComponent'],
  ['any picker remains an explicit opaque registration', 'src/components/AnyIconPicker.tsx', 'import { VideoOff } from "lucide-react"; function selectIcon(): any { return VideoOff }; export function AnyIconPicker() { const Icon = selectIcon(); return <Icon /> }', 'ui-role-names', 'opaqueComponent'],
  ['own factory returning a renderer is not itself a component', 'src/lib/ownRendererFactory.ts', 'export function selectRenderer() { return () => null }', null],
  ['own opaque picker remains diagnostic rather than foreign', 'src/components/OwnPickerConsumer.tsx', 'import { selectRenderer } from "@/lib/ownRendererFactory"; export function OwnPickerConsumer() { const Renderer = selectRenderer(); return <Renderer /> }', 'ui-role-names', 'opaqueComponent'],
  ['same-signature alias backend use remains blocked', 'src/lib/typedAliasBackend.ts', 'const retrieve: typeof fetch = fetch; export const load = () => retrieve("/api/v1/auth/me")', 'ui-service-boundary', 'fetch'],
  ['same-signature alias callback escape remains blocked', 'src/lib/typedAliasCallback.ts', 'const retrieve: typeof fetch = fetch; const forward = (fn: (url: string) => Promise<Response>) => fn("/api/v1/auth/me"); export const load = () => forward(retrieve)', 'ui-service-boundary', 'escapedFetch'],
  ['destructured alias backend use remains blocked', 'src/lib/destructuredBackend.ts', 'const { fetch: retrieve } = window; export const load = () => retrieve("/api/v1/auth/me")', 'ui-service-boundary', 'fetch'],
  ['destructured alias callback escape remains blocked', 'src/lib/destructuredCallback.ts', 'const { ["fetch"]: retrieve } = window; const forward = (fn: (url: string) => Promise<Response>) => fn("/api/v1/auth/me"); export const load = () => forward(retrieve)', 'ui-service-boundary', 'escapedFetch'],
  ['service must handle rejected work', 'src/services/floatingService.ts', 'export function run() { Promise.resolve("result") }', '@typescript-eslint/no-floating-promises', 'floating'],
  ['void cannot conceal an unhandled service promise', 'src/services/voidPromiseService.ts', 'export function run() { void Promise.resolve("result") }', '@typescript-eslint/no-floating-promises', 'floating'],
  ['service callback cannot discard an async result', 'src/services/asyncCallbackService.ts', 'export function run() { [1].forEach(async (value) => { await Promise.resolve(value) }) }', '@typescript-eslint/no-misused-promises', 'voidReturnArgument'],
  ['service can return work to its caller', 'src/services/returnedPromiseService.ts', 'export function run() { return Promise.resolve("result") }', null],
  ['service can await work', 'src/services/awaitedPromiseService.ts', 'export async function run() { await Promise.resolve("result") }', null],
  ['service can explicitly handle background failures', 'src/services/handledPromiseService.ts', 'export function run() { void Promise.resolve("result").catch((error: unknown) => { console.error(error) }) }', null],
  ['service redundant casts cannot conceal type assumptions', 'src/services/redundantAssertionService.ts', 'export function run(value: string) { return value as string }', '@typescript-eslint/no-unnecessary-type-assertion', 'unnecessaryAssertion'],
  ['feature service redundant non-null assertions are rejected', 'src/features/sample/services/redundantAssertion.ts', 'export function run(value: string) { return value! }', '@typescript-eslint/no-unnecessary-type-assertion', 'unnecessaryAssertion'],
  ['guarded queue extraction can retain a necessary assertion', 'src/services/guardedQueueService.ts', 'export function take(queue: string[]) { if (queue.length === 0) return null; return queue.shift()! }', null],
  ['framework field initialization remains distinct from assertions', 'src/services/frameworkValueService.ts', 'export class FrameworkInitializedValue { value!: string }', null],
  ['canonical response transport slot', 'src/lib/wireResponse.ts', 'import { requestJson as load } from "@/services/apiClient"; import type { RecordResponseDto } from "@/services/api/records/dto/record-response.dto"; export const read = async () => (await load("/records")) as RecordResponseDto', null],
  ['renamed wire declaration cannot use a domain name', 'src/lib/wireRename.ts', 'import { requestJson } from "@/services/apiClient"; import type { RenamedRecord } from "@/services/api/records/dto/renamed-response.dto"; export const read = async () => (await requestJson("/records")) as RenamedRecord', 'wire-dto-ownership', 'owner'],
  ['moved wire declaration cannot use a domain directory', 'src/lib/wireMoved.ts', 'import { requestJson } from "@/services/apiClient"; import type { MovedResponseDto } from "@/types/movedWire"; export const read = async () => (await requestJson("/records")) as MovedResponseDto', 'wire-dto-ownership', 'owner'],
  ['wrong wire filename cannot hide canonical name', 'src/lib/wireFilename.ts', 'import { requestJson } from "@/services/apiClient"; import type { WrongFileDto } from "@/services/api/records/dto/misc"; export const read = async () => (await requestJson("/records")) as WrongFileDto', 'wire-dto-ownership', 'owner'],
  ['inline payload transport assertion', 'src/lib/wireInline.ts', 'import { requestJson } from "@/services/apiClient"; export const read = async () => (await requestJson("/records")) as { id: string }', 'wire-dto-ownership', 'unsupported'],
  ['immutable transport alias retains provenance', 'src/lib/wireRawAlias.ts', 'import { requestJson } from "@/services/apiClient"; export async function read() { const body = await requestJson("/records"); return body as { id: string } }', 'wire-dto-ownership', 'unsupported'],
  ['namespaced transport alias retains provenance', 'src/lib/wireNamespace.ts', 'import * as transport from "@/services/apiClient"; const load = transport.requestJson; export const read = async () => (await load("/records")) as { id: string }', 'wire-dto-ownership', 'unsupported'],
  ['wire generic slot rejects a domain view', 'src/lib/wireGeneric.ts', 'import { requestJson } from "@/services/apiClient"; import type { MisusedView } from "@/types/misusedView"; function parse<T>(value: unknown) { return value as T }; export const read = async () => parse<MisusedView>(await requestJson("/records"))', 'wire-dto-ownership', 'owner'],
  ['wire generic slot accepts canonical DTO', 'src/lib/wireGenericDto.ts', 'import { requestJson } from "@/services/apiClient"; import type { RecordResponseDto } from "@/services/api/records/dto/record-response.dto"; function parse<T>(value: unknown) { return value as T }; export const read = async () => parse<RecordResponseDto>(await requestJson("/records"))', null],
  ['mapper unknown slot preserves camera keyof identity', 'src/services/api/wireMapper.ts', 'import type { RecordResponseDto } from "./records/dto/record-response.dto"; export function parse(value: unknown) { const dto = value as Record<keyof RecordResponseDto, unknown>; if (typeof dto.id !== "string") throw new Error("invalid"); return { id: dto.id } satisfies RecordResponseDto }', null],
  ['mapper generic computational helper is not a wire declaration', 'src/services/api/genericHelper.ts', 'export function array<T>(value: unknown): T[] { if (!Array.isArray(value)) throw new Error("invalid"); return value as T[] }', null],
  ['mapper generic object guard is not payload ownership', 'src/services/api/objectGuard.ts', 'export function record(value: unknown) { return value as Record<string, unknown> }', null],
  ['request satisfies anchors canonical DTO', 'src/lib/wireRequest.ts', 'import { requestJson } from "@/services/apiClient"; import type { RecordRequestDto } from "@/services/api/records/dto/record-request.dto"; export const send = () => requestJson("/records", { body: JSON.stringify({ id: "1" } satisfies RecordRequestDto) })', null],
  ['request inline body is unsupported wire identity', 'src/lib/wireRequestInline.ts', 'import { requestJson } from "@/services/apiClient"; export const send = () => requestJson("/records", { body: JSON.stringify({ id: "1" }) })', 'wire-dto-ownership', 'unsupported'],
  ['same-spelled local transport is not wire evidence', 'src/lib/localJson.ts', 'const requestJson = async () => ({ id: "1" }); export const read = async () => (await requestJson()) as { id: string }', null],
  ['separate structurally identical domain view stays valid', 'src/pages/DomainRecordView.ts', 'export type { DomainRecord } from "@/types/domainRecord"', null],
  ['wire service transparent type alias leaks', 'src/pages/WireServiceAlias.ts', 'export type { WireView } from "@/services/wireViewService"', 'ui-service-boundary', 'endpoint'],
  ['wire shared interface extends leaks', 'src/pages/WireInterface.ts', 'export type { WireExtension } from "@/types/wireAliases"', 'ui-service-boundary', 'endpoint'],
  ['wire shared Pick wrapper leaks', 'src/pages/WirePick.ts', 'export type { WirePick } from "@/types/wireAliases"', 'ui-service-boundary', 'endpoint'],
  ['wire ReturnType wrapper leaks', 'src/pages/WireReturn.ts', 'export type { WireReturn } from "@/types/wireAliases"', 'ui-service-boundary', 'endpoint'],
  ['wire inferred ReturnType wrapper leaks', 'src/pages/WireInferredReturn.ts', 'export type { WireInferredReturn } from "@/types/wireAliases"', 'ui-service-boundary', 'endpoint'],
  ['wire moved declaration still leaks through public view name', 'src/pages/MovedWireView.ts', 'export type { MovedResponseDto as View } from "@/types/movedWire"', 'ui-service-boundary', 'endpoint'],
  ['workflow domain ReturnType is not a wire alias', 'src/pages/WorkflowView.ts', 'export type { WorkflowView } from "@/types/wireAliases"', null],
  ['wire tests retain test identity exception', 'src/lib/wire.test.ts', 'import { requestJson } from "@/services/apiClient"; export const read = async () => (await requestJson("/records")) as { id: string }', null],
  ['wire erased transport alias remains attributable', 'src/lib/wireErasedTransport.ts', 'import { requestJson } from "@/services/apiClient"; const load: (path: string) => Promise<unknown> = requestJson; export const read = async () => (await load("/records")) as { id: string }', 'wire-dto-ownership', 'unsupported'],
  ['wire response annotation is a payload slot', 'src/lib/wireAnnotation.ts', 'import { requestJson } from "@/services/apiClient"; export async function read() { const body: { id: string } = await requestJson("/records"); return body }', 'wire-dto-ownership', 'unsupported'],
  ['mapper return satisfies preserves DTO identity', 'src/services/api/wireSatisfied.ts', 'import type { RecordResponseDto } from "./records/dto/record-response.dto"; export function parse(value: unknown) { return { id: String(value) } satisfies RecordResponseDto }', null],
  ['mapper return satisfies rejects renamed wire identity', 'src/services/api/wireSatisfiedRename.ts', 'import type { RenamedRecord } from "./records/dto/renamed-response.dto"; export function parse(value: unknown) { return { id: String(value) } satisfies RenamedRecord }', 'wire-dto-ownership', 'owner'],
  ['wire mutable transport ownership is explicitly unsupported', 'src/lib/wireMutable.ts', 'import { requestJson } from "@/services/apiClient"; export async function read() { let body = await requestJson("/records"); body = "changed"; return body }', 'wire-dto-ownership', 'unsupported'],
  ['wire declaration alias filename is checked after reexport', 'src/lib/wireReexport.ts', 'import { requestJson } from "@/services/apiClient"; import type { Payload } from "@/types/wireReexport.js"; export const read = async () => (await requestJson("/records")) as Payload', 'wire-dto-ownership', 'owner'],
  ['typed request binding retains its canonical DTO slot', 'src/lib/wireRequestBinding.ts', 'import { requestJson } from "@/services/apiClient"; import type { RecordRequestDto } from "@/services/api/records/dto/record-request.dto"; const payload: RecordRequestDto = { id: "1" }; const options = { body: JSON.stringify(payload) }; export const send = () => requestJson("/records", options)', null],
  ['explicit mutable JSON body alias fails closed', 'src/lib/wireMutableJsonExplicit.ts', 'import { requestJson } from "@/services/apiClient"; let body = JSON.stringify({ id: "1" }); body = JSON.stringify({ id: "2" }); export const send = () => requestJson("/records", { body: body })', 'wire-dto-ownership', 'unsupported'],
  ['shorthand mutable JSON body alias fails closed', 'src/lib/wireMutableJsonShorthand.ts', 'import { requestJson } from "@/services/apiClient"; let body = JSON.stringify({ id: "1" }); body = JSON.stringify({ id: "2" }); export const send = () => requestJson("/records", { body })', 'wire-dto-ownership', 'unsupported'],
  ['explicit immutable canonical JSON DTO alias remains valid', 'src/lib/wireCanonicalJsonExplicit.ts', 'import { requestJson } from "@/services/apiClient"; import type { RecordRequestDto } from "@/services/api/records/dto/record-request.dto"; const body = JSON.stringify({ id: "1" } satisfies RecordRequestDto); export const send = () => requestJson("/records", { body: body })', null],
  ['shorthand immutable canonical JSON DTO alias remains valid', 'src/lib/wireCanonicalJsonShorthand.ts', 'import { requestJson } from "@/services/apiClient"; import type { RecordRequestDto } from "@/services/api/records/dto/record-request.dto"; const body = JSON.stringify({ id: "1" } satisfies RecordRequestDto); export const send = () => requestJson("/records", { body })', null],
  ['shorthand noncanonical JSON body alias fails ownership', 'src/lib/wireNoncanonicalJsonShorthand.ts', 'import { requestJson } from "@/services/apiClient"; const body = JSON.stringify({ id: "1" }); export const send = () => requestJson("/records", { body })', 'wire-dto-ownership', 'unsupported'],
  ['explicit primitive FormData and Blob bodies remain valid', 'src/lib/requestBinaryExplicit.ts', 'import { requestJson } from "@/services/apiClient"; export const send = (body: string | FormData | Blob) => requestJson("/records", { body: body })', null],
  ['shorthand primitive FormData and Blob bodies remain valid', 'src/lib/requestBinaryShorthand.ts', 'import { requestJson } from "@/services/apiClient"; export const send = (body: string | FormData | Blob) => requestJson("/records", { body })', null],
  ['explicit imported inline JSON body fails ownership', 'src/lib/wireImportedJsonExplicit.ts', 'import { requestJson } from "@/services/apiClient"; import { inlineJson as payload } from "@/lib/optionFactories"; export const send = () => requestJson("/records", { body: payload })', 'wire-dto-ownership', 'unsupported'],
  ['shorthand reexported renamed inline JSON body fails ownership', 'src/lib/wireImportedJsonShorthand.ts', 'import { requestJson } from "@/services/apiClient"; import { reexportedInlineJson as body } from "@/lib/optionFactories"; export const send = () => requestJson("/records", { body })', 'wire-dto-ownership', 'unsupported'],
  ['explicit imported canonical DTO JSON body remains valid', 'src/lib/wireImportedCanonicalExplicit.ts', 'import { requestJson } from "@/services/apiClient"; import { canonicalJson as payload } from "@/lib/optionFactories"; export const send = () => requestJson("/records", { body: payload })', null],
  ['shorthand reexported renamed canonical DTO JSON body remains valid', 'src/lib/wireImportedCanonicalShorthand.ts', 'import { requestJson } from "@/services/apiClient"; import { reexportedCanonicalJson as body } from "@/lib/optionFactories"; export const send = () => requestJson("/records", { body })', null],
  ['shorthand imported mutable JSON body fails closed', 'src/lib/wireImportedMutableJson.ts', 'import { requestJson } from "@/services/apiClient"; import { reexportedMutableJson as body } from "@/lib/optionFactories"; export const send = () => requestJson("/records", { body })', 'wire-dto-ownership', 'unsupported'],
  ['shadowed JSON serializer does not establish wire shape', 'src/lib/localSerializer.ts', 'import { requestJson } from "@/services/apiClient"; const JSON = { stringify: (value: { id: string }) => value.id }; export const send = () => requestJson("/records", { body: JSON.stringify({ id: "1" }) })', null],
  ['wire namespace type wrapper leaks', 'src/pages/WireNamespaceType.ts', 'export type { WireNamespace } from "@/types/wireAliases"', 'ui-service-boundary', 'endpoint'],
  ['wire inferred async ReturnType wrapper leaks', 'src/pages/WireAsyncReturn.ts', 'export type { WireAsyncReturn } from "@/types/wireAliases"', 'ui-service-boundary', 'endpoint'],
  ['whole transport Record cannot replace canonical payload identity', 'src/lib/wireWholeRecord.ts', 'import { requestJson } from "@/services/apiClient"; export const read = async () => (await requestJson("/records")) as Record<string, unknown>', 'wire-dto-ownership', 'unsupported'],
  ['JSON in a request header is not payload identity', 'src/lib/wireHeader.ts', 'import { requestJson } from "@/services/apiClient"; export const read = () => requestJson("/records", { headers: { "X-Metadata": JSON.stringify({ trace: "test" }) } })', null],
  ['one-hop literal factory retains canonical body ownership', 'src/lib/optionsLiteral.ts', 'import { requestJson } from "@/services/apiClient"; import { literalOptions } from "@/lib/optionFactories"; export const send = () => requestJson("/records", literalOptions({ id: "1" }))', null],
  ['renamed imported factory retains canonical body ownership', 'src/lib/optionsRenamed.ts', 'import { requestJson } from "@/services/apiClient"; import { signalOptions as renamed } from "@/lib/optionFactories"; export const send = (signal?: AbortSignal) => requestJson("/records", renamed({ body: { id: "1" }, signal }))', null],
  ['local arrow literal factory is supported', 'src/lib/optionsArrow.ts', 'import { requestJson } from "@/services/apiClient"; import type { RecordRequestDto } from "@/services/api/records/dto/record-request.dto"; const create = (body: RecordRequestDto): RequestInit => ({ body: JSON.stringify(body) }); export const send = () => requestJson("/records", create({ id: "1" }))', null],
  ['untyped factory payload is not certified by RequestInit', 'src/lib/optionsBroad.ts', 'import { requestJson } from "@/services/apiClient"; import { broadOptions as renamed } from "@/lib/optionFactories"; export const send = () => requestJson("/records", renamed({ id: "1" }))', 'wire-dto-ownership', 'unsupported'],
  ['factory body property Record cannot launder wire ownership', 'src/lib/optionsRecord.ts', 'import { requestJson } from "@/services/apiClient"; import { recordOptions } from "@/lib/optionFactories"; export const send = () => requestJson("/records", recordOptions({ body: { id: "1" } }))', 'wire-dto-ownership', 'unsupported'],
  ['opaque imported producer fails closed', 'src/lib/optionsOpaque.ts', 'import { requestJson } from "@/services/apiClient"; import { opaqueOptions } from "@/lib/optionFactories"; export const send = () => requestJson("/records", opaqueOptions())', 'wire-dto-ownership', 'unsupported'],
  ['inline renamed unknown producer fails closed', 'src/lib/optionsUnknown.ts', 'import { requestJson } from "@/services/apiClient"; declare const renamed: () => RequestInit; export const send = () => requestJson("/records", renamed())', 'wire-dto-ownership', 'unsupported'],
  ['nested producer is outside one-hop certificate', 'src/lib/optionsNested.ts', 'import { requestJson } from "@/services/apiClient"; import { nestedOptions } from "@/lib/optionFactories"; export const send = () => requestJson("/records", nestedOptions({ id: "1" }))', 'wire-dto-ownership', 'unsupported'],
  ['factory mutated body fails closed', 'src/lib/optionsMutated.ts', 'import { requestJson } from "@/services/apiClient"; import { mutatedOptions } from "@/lib/optionFactories"; export const send = () => requestJson("/records", mutatedOptions({ id: "1" }))', 'wire-dto-ownership', 'unsupported'],
  ['factory computed body write fails closed', 'src/lib/optionsComputed.ts', 'import { requestJson } from "@/services/apiClient"; import { computedOptions } from "@/lib/optionFactories"; export const send = () => requestJson("/records", computedOptions({ id: "1" }, "body"))', 'wire-dto-ownership', 'unsupported'],
  ['factory aliased options mutation fails closed', 'src/lib/optionsAliased.ts', 'import { requestJson } from "@/services/apiClient"; import { aliasedOptions } from "@/lib/optionFactories"; export const send = () => requestJson("/records", aliasedOptions({ id: "1" }))', 'wire-dto-ownership', 'unsupported'],
  ['factory canonical union cannot hide anonymous body arm', 'src/lib/optionsMixedUnion.ts', 'import { requestJson } from "@/services/apiClient"; import { mixedOptions } from "@/lib/optionFactories"; export const send = () => requestJson("/records", mixedOptions({ body: { id: "1" } }))', 'wire-dto-ownership', 'unsupported'],
  ['direct options body mutation fails closed', 'src/lib/optionsDirectMutation.ts', 'import { requestJson } from "@/services/apiClient"; const options: RequestInit = { method: "POST" }; options.body = JSON.stringify({ hidden: true }); export const send = () => requestJson("/records", options)', 'wire-dto-ownership', 'unsupported'],
  ['direct options conditional signal assignment stays valid', 'src/lib/optionsDirectSignal.ts', 'import { requestJson } from "@/services/apiClient"; export function read(signal?: AbortSignal) { const options: RequestInit = { method: "GET" }; if (signal !== undefined) options.signal = signal; return requestJson("/records", options) }', null],
  ['factory transport-only options remain valid', 'src/lib/optionsTransportOnly.ts', 'import { requestJson } from "@/services/apiClient"; const options = (): RequestInit => ({ method: "GET", credentials: "include" }); export const read = () => requestJson("/records", options())', null],
  ['empty one-hop options factory remains valid', 'src/lib/optionsEmpty.ts', 'import { requestJson } from "@/services/apiClient"; function options(): RequestInit { return {} }; export const read = () => requestJson("/records", options())', null],
  ['non-JSON body factory preserves primitive FormData and blob', 'src/lib/optionsBinary.ts', 'import { requestJson } from "@/services/apiClient"; const options = (body: string | FormData | Blob): RequestInit => ({ body }); export const send = (body: string | FormData | Blob) => requestJson("/records", options(body))', null],
  ['immutable options literal spread stays valid', 'src/lib/optionsSpread.ts', 'import { requestJson } from "@/services/apiClient"; const base = { method: "GET" }; export const read = () => requestJson("/records", { ...base, credentials: "include" })', null],
  ['spread opaque producer is not silently skipped', 'src/lib/optionsSpreadOpaque.ts', 'import { requestJson } from "@/services/apiClient"; declare const options: () => RequestInit; export const read = () => requestJson("/records", { ...options() })', 'wire-dto-ownership', 'unsupported'],
  ['factory canonical parameter union remains valid', 'src/lib/optionsUnionParameter.ts', 'import { requestJson } from "@/services/apiClient"; import { unionOptions } from "@/lib/optionFactories"; export const send = () => requestJson("/records", unionOptions({ id: "1" }))', null],
  ['exported mutable options capability is not a local literal certificate', 'src/lib/optionsImportedLiteral.ts', 'import { requestJson } from "@/services/apiClient"; import { sharedOptions } from "@/lib/optionFactories"; sharedOptions.body = "changed"; export const send = () => requestJson("/records", sharedOptions)', 'wire-dto-ownership', 'unsupported'],
  ['static computed signal assignment preserves factory body', 'src/lib/optionsStaticSignal.ts', 'import { requestJson } from "@/services/apiClient"; import type { RecordRequestDto } from "@/services/api/records/dto/record-request.dto"; function create(body: RecordRequestDto, signal?: AbortSignal): RequestInit { const options: RequestInit = { body: JSON.stringify(body) }; if (signal) options["signal"] = signal; return options }; export const send = (signal?: AbortSignal) => requestJson("/records", create({ id: "1" }, signal))', null],
  ['outside visual side effects are not production code', 'src/lib/OutsideSideEffect.ts', 'import "../../visual/sideEffect"; export const ready = true', 'resolvable-imports', 'outsideProduction'],
  ['outside ordinary fetch wrapper cannot evade src enforcement', 'src/lib/OutsideFetch.ts', 'import { load } from "../../visual/ordinary"; export const run = () => load()', 'resolvable-imports', 'outsideProduction'],
  ['outside ordinary transport wrapper cannot evade src enforcement', 'src/lib/OutsideTransport.ts', 'import { request } from "../../visual/transport"; export const run = () => request()', 'resolvable-imports', 'outsideProduction'],
  ['registered outside component cannot evade src enforcement', 'src/components/OutsideHost.tsx', 'import { OutsidePanel } from "../../visual/OutsidePanel"; export function OutsideHost() { return <OutsidePanel /> }', 'resolvable-imports', 'outsideProduction'],
  ['root tooling cannot enter production runtime', 'src/lib/OutsideTooling.ts', 'export { build } from "../../build-tool"', 'resolvable-imports', 'outsideProduction'],
  ['outside js specifier still resolves to forbidden TS', 'src/lib/OutsideExtension.ts', 'export { load } from "../../visual/ordinary.js"', 'resolvable-imports', 'outsideProduction'],
  ['alias dot segments cannot leave enforced production', 'src/lib/OutsideAlias.ts', 'export { load } from "@/../visual/ordinary"', 'resolvable-imports', 'outsideProduction'],
  ['feature barrel cannot expose outside runtime wrapper', 'src/features/outside/index.ts', 'export { load } from "../../../visual/ordinary"', 'resolvable-imports', 'outsideProduction'],
  ['outside barrel is not an enforcement boundary', 'src/lib/OutsideBarrel.ts', 'export { load } from "../../visual/barrel"', 'resolvable-imports', 'outsideProduction'],
  ['outside export-all is a runtime edge', 'src/lib/OutsideExportAll.ts', 'export * from "../../visual/ordinary"', 'resolvable-imports', 'outsideProduction'],
  ['outside static dynamic import is a runtime edge', 'src/lib/OutsideDynamic.ts', 'export const load = () => import("../../visual/ordinary")', 'resolvable-imports', 'outsideProduction'],
  ['outside CommonJS require is a runtime edge', 'src/lib/OutsideRequire.cts', 'const bridge = require("../../visual/ordinary"); export const load = bridge.load', 'resolvable-imports', 'outsideProduction'],
  ['outside import-equals is a runtime edge', 'src/lib/OutsideEquals.cts', 'import bridge = require("../../visual/ordinary"); export const load = bridge.load', 'resolvable-imports', 'outsideProduction'],
  ['local declaration and JS pair cannot hide runtime edge', 'src/lib/OutsideDeclarationPair.ts', 'export { bridge } from "../../visual/bridge"', 'resolvable-imports', 'outsideProduction'],
  ['local explicit JS declaration pair cannot hide runtime edge', 'src/lib/OutsideDeclarationPairJs.ts', 'export { bridge } from "../../visual/bridge.js"', 'resolvable-imports', 'outsideProduction'],
  ['fake asset alias spelling cannot hide resolved executable', 'src/lib/OutsideFakeAsset.ts', 'export { load } from "@fake-asset.svg"', 'resolvable-imports', 'outsideProduction'],
  ['relative code outside worktree is still local executable', 'src/lib/OutsideWorktree.ts', 'export { external } from "../../../external/helper"', 'resolvable-imports', 'outsideProduction'],
  ['outside mixed type and value import remains runtime', 'src/lib/OutsideMixed.ts', 'import { type OutsideModel, value } from "../../visual/contracts"; export const model: OutsideModel = value', 'resolvable-imports', 'outsideProduction'],
  ['actual installed package keeps library provenance', 'src/lib/ActualLibrary.ts', 'import { isValidElement } from "react"; export const check = isValidElement', null],
  ['outside JSON is data rather than executable', 'src/lib/OutsideJson.ts', 'import settings from "../../visual/settings.json"; export const enabled = settings.enabled', null],
  ['outside real asset keeps existing Vite resource allowance', 'src/lib/OutsideAsset.ts', 'import icon from "../../visual/icon.svg"; export const url = icon', null],
  ['outside stylesheet keeps existing Vite resource allowance', 'src/lib/OutsideStyle.ts', 'import "../../visual/theme.css"; export const styled = true', null],
  ['outside explicit type-only import is erased', 'src/lib/OutsideType.ts', 'import type { OutsideModel } from "../../visual/contracts"; export type Model = OutsideModel', null],
  ['outside explicit type-only reexport is erased', 'src/lib/OutsideTypeExport.ts', 'export type { OutsideModel } from "../../visual/contracts"', null],
  ['outside inline type-only import is erased without verbatim modules', 'src/lib/OutsideInlineType.ts', 'import { type OutsideModel } from "../../visual/contracts"; export type Model = OutsideModel', null],
  ['outside namespace type-only import is erased', 'src/lib/OutsideNamespaceType.ts', 'import type * as outside from "../../visual/contracts"; export type Model = outside.OutsideModel', null],
  ['outside import type query does not load runtime wrapper', 'src/lib/OutsideTypeQuery.ts', 'export type Loader = typeof import("../../visual/ordinary").load', null],
  ['outside declaration pair type-only edge stays erased', 'src/lib/OutsidePairType.ts', 'import type { BridgeResult } from "../../visual/bridge"; export type Result = BridgeResult', null],
  ['visual consuming src is the permitted reverse direction', 'visual/consumer.ts', 'import { internal } from "../src/features/alpha/internal"; export const value = internal', null],
  ['test consuming outside code retains test identity', 'src/test/OutsideConsumer.test.ts', 'import { load } from "../../visual/ordinary"; export const run = load', null],
  ['outside test import keeps only existing test diagnostic', 'src/lib/OutsideTest.ts', 'export { fixture } from "../../visual/outside.test"', 'no-production-test-imports', 'test'],
  ['outside transparent test barrel keeps only existing test diagnostic', 'src/lib/OutsideTestBarrel.ts', 'export { fixture } from "../../visual/test-barrel"', 'no-production-test-imports', 'test'],
  ['real target of src symlink cannot escape enforcement', 'src/lib/OutsideSymlink.ts', 'export { load } from "@/lib/linkedOutside"', 'resolvable-imports', 'outsideProduction'],
  ['outside inline type-only reexport is erased without verbatim modules', 'src/lib/OutsideInlineTypeExport.ts', 'export { type OutsideModel } from "../../visual/contracts"', null],
  ['outside type-only import-equals is erased', 'src/lib/OutsideTypeEquals.cts', 'import type bridge = require("../../visual/bridge"); export type Result = bridge.BridgeResult', null],
  ['outside worktree type-only contract remains permitted', 'src/lib/OutsideWorktreeType.ts', 'import type { ExternalModel } from "../../../external/helper"; export type Model = ExternalModel', null],
  ['lazy Vite glob cannot import outside executable', 'src/lib/GlobOutsideLazy.ts', 'export const files = import.meta.glob("../../visual/loader-outside/*.ts")', 'resolvable-imports', 'outsideProduction'],
  ['eager Vite glob cannot import outside executable', 'src/lib/GlobOutsideEager.ts', 'export const files = import.meta.glob("../../visual/loader-outside/*.ts", { eager: true })', 'resolvable-imports', 'outsideProduction'],
  ['project-root glob resolves actual outside target', 'src/lib/GlobRoot.ts', 'export const files = import.meta.glob("/visual/loader-outside/*.ts")', 'resolvable-imports', 'outsideProduction'],
  ['owned in-src lazy glob is valid', 'src/lib/GlobOwned.ts', 'export const files = import.meta.glob("./loader-owned/*.ts")', null],
  ['negative glob excludes outside executable', 'src/lib/GlobExcluded.ts', 'export const files = import.meta.glob(["/src/lib/loader-owned/*.ts", "/visual/loader-outside/*.ts", "!/visual/loader-outside/*.ts"], { eager: true })', null],
  ['existing dynamic glob base certifies empty result', 'src/lib/GlobEmpty.ts', 'export const files = import.meta.glob("./loader-owned/*.absent.ts")', null],
  ['negative glob can certify exclusion of every match', 'src/lib/GlobAllExcluded.ts', 'export const files = import.meta.glob(["./loader-owned/*.ts", "!./loader-owned/*.ts"])', null],
  ['missing exact glob target is not certified empty', 'src/lib/GlobMissingFile.ts', 'export const files = import.meta.glob("./loader-owned/missing.ts")', 'resolvable-imports', 'unresolvedGlob'],
  ['missing glob directory is not certified empty', 'src/lib/GlobMissingBase.ts', 'export const files = import.meta.glob("./loader-missing/*.ts")', 'resolvable-imports', 'unresolvedGlob'],
  ['empty glob pattern list is unsupported', 'src/lib/GlobNoPatterns.ts', 'export const files = import.meta.glob([])', 'resolvable-imports', 'unsupportedLoader'],
  ['computed glob pattern is unsupported', 'src/lib/GlobComputed.ts', 'const pattern = "./loader-owned/*.ts"; export const files = import.meta.glob(pattern)', 'resolvable-imports', 'unsupportedLoader'],
  ['glob aliases require explicit unsupported diagnostic', 'src/lib/GlobAlias.ts', 'export const files = import.meta.glob("@/lib/loader-owned/*.ts")', 'resolvable-imports', 'unsupportedLoader'],
  ['computed glob options are unsupported', 'src/lib/GlobOptions.ts', 'const options = { eager: true }; export const files = import.meta.glob("./loader-owned/*.ts", options)', 'resolvable-imports', 'unsupportedLoader'],
  ['unsupported glob option is diagnosed', 'src/lib/GlobUnknownOption.ts', 'export const files = import.meta.glob("./loader-owned/*.ts", { base: "/" })', 'resolvable-imports', 'unsupportedLoader'],
  ['non-exhaustive glob excludes hidden executable', 'src/lib/GlobHiddenExcluded.ts', 'export const files = import.meta.glob("../../visual/loader-hidden/*.ts")', null],
  ['exhaustive glob includes hidden executable', 'src/lib/GlobHiddenIncluded.ts', 'export const files = import.meta.glob("../../visual/loader-hidden/*.ts", { exhaustive: true })', 'resolvable-imports', 'outsideProduction'],
  ['non-exhaustive glob excludes node_modules matches', 'src/lib/GlobPackagesExcluded.ts', 'export const files = import.meta.glob("../features/alpha/**/loader-entry.ts")', null],
  ['exhaustive glob still applies feature boundary', 'src/lib/GlobPackagesIncluded.ts', 'export const files = import.meta.glob("../features/alpha/**/loader-entry.ts", { exhaustive: true })', 'feature-public-api', 'feature'],
  ['glob symlink uses real outside target', 'src/lib/GlobSymlink.ts', 'export const files = import.meta.glob("./loader-linked/*.ts")', 'resolvable-imports', 'outsideProduction'],
  ['glob applies private feature boundary', 'src/lib/GlobFeature.ts', 'export const files = import.meta.glob("../features/alpha/internal.ts")', 'feature-public-api', 'feature'],
  ['same feature glob can load its internals', 'src/features/alpha/globOwned.ts', 'export const files = import.meta.glob("./internal.ts")', null],
  ['glob applies production test boundary', 'src/lib/GlobTest.ts', 'export const files = import.meta.glob("../test/loader-entry.test.ts")', 'no-production-test-imports', 'test'],
  ['UI glob cannot directly consume endpoint', 'src/hooks/GlobEndpoint.ts', 'export const files = import.meta.glob("../services/api/records.ts")', 'ui-service-boundary', 'endpoint'],
  ['UI glob named transport export is forbidden', 'src/hooks/GlobTransport.ts', 'export const files = import.meta.glob("../services/apiClient.ts", { import: "requestJson" })', 'ui-service-boundary', 'transport'],
  ['UI glob can select actual error presentation helper', 'src/hooks/GlobErrorHelper.ts', 'export const files = import.meta.glob("../services/apiClient.ts", { import: "apiErrorMessage" })', null],
  ['exact raw query imports nonexecuting text', 'src/lib/GlobRaw.ts', 'export const files = import.meta.glob("../../visual/loader-outside/*.ts", { query: "?raw", import: "default" })', null],
  ['exact url query imports nonexecuting URLs', 'src/lib/GlobUrl.ts', 'export const files = import.meta.glob("../../visual/loader-outside/*.ts", { query: "?url", import: "default" })', null],
  ['legacy raw option has explicit nonexecuting meaning', 'src/lib/GlobAsRaw.ts', 'export const files = import.meta.glob("../../visual/loader-outside/*.ts", { as: "raw" })', null],
  ['raw substring is not a data exemption', 'src/lib/GlobFakeRaw.ts', 'export const files = import.meta.glob("../../visual/loader-outside/*.ts", { query: "?notraw" })', 'resolvable-imports', 'unsupportedLoader'],
  ['raw and worker query mixture is unsupported', 'src/lib/GlobMixedQuery.ts', 'export const files = import.meta.glob("../../visual/loader-outside/*.ts", { query: "?raw&worker" })', 'resolvable-imports', 'unsupportedLoader'],
  ['worker url query still denotes executable capability', 'src/lib/GlobWorkerUrl.ts', 'export const files = import.meta.glob("../../visual/loader-outside/*.ts", { query: "?worker&url" })', 'resolvable-imports', 'outsideProduction'],
  ['worker query cannot borrow JSON data exemption', 'src/lib/GlobWorkerJson.ts', 'export const files = import.meta.glob("../../visual/settings.json", { query: "?worker" })', 'resolvable-imports', 'outsideProduction'],
  ['real asset glob remains non-code resource', 'src/lib/GlobAsset.ts', 'export const files = import.meta.glob("../../visual/icon.svg")', null],
  ['same-named fake glob is not Vite loader', 'src/lib/FakeGlob.ts', 'const fake = { glob: (pattern: string) => pattern }; export const files = fake.glob("../../visual/loader-outside/*.ts")', null],
  ['native Worker cannot load outside executable', 'src/lib/WorkerOutside.ts', 'export const worker = new Worker(new URL("../../visual/loader-outside/entry.ts", import.meta.url), { type: "module" })', 'resolvable-imports', 'outsideProduction'],
  // Vite 5 Worker URL entry resolution does not perform ordinary-import .js -> .ts substitution.
  ['native Worker missing js cannot borrow outside sibling ts', 'src/lib/WorkerExtension.ts', 'export const worker = new Worker(new URL("../../visual/loader-outside/entry.js", import.meta.url), { type: "module" })', 'resolvable-imports', 'unresolved'],
  ['native Worker can load owned src entry', 'src/lib/WorkerOwned.ts', 'export const worker = new Worker(new URL("./loader-owned/entry.ts", import.meta.url), { type: "module" })', null],
  ['native Worker applies private feature boundary', 'src/lib/WorkerFeature.ts', 'export const worker = new Worker(new URL("../features/alpha/internal.ts", import.meta.url))', 'feature-public-api', 'feature'],
  ['native Worker applies production test boundary', 'src/lib/WorkerTest.ts', 'export const worker = new Worker(new URL("../test/loader-entry.test.ts", import.meta.url))', 'no-production-test-imports', 'test'],
  ['computed Worker URL target is unsupported', 'src/lib/WorkerComputed.ts', 'const entry = "./loader-owned/entry.ts"; export const worker = new Worker(new URL(entry, import.meta.url))', 'resolvable-imports', 'unsupportedLoader'],
  ['opaque Worker URL object is unsupported', 'src/lib/WorkerOpaque.ts', 'const url = new URL("./loader-owned/entry.ts", import.meta.url); export const worker = new Worker(url)', 'resolvable-imports', 'unsupportedLoader'],
  ['native Worker options cannot be opaque', 'src/lib/WorkerOptions.ts', 'const options: WorkerOptions = { type: "module" }; export const worker = new Worker(new URL("./loader-owned/entry.ts", import.meta.url), options)', 'resolvable-imports', 'unsupportedLoader'],
  ['native Worker raw query cannot erase executable capability', 'src/lib/WorkerRaw.ts', 'export const worker = new Worker(new URL("../../visual/loader-outside/entry.ts?raw", import.meta.url))', 'resolvable-imports', 'unsupportedLoader'],
  ['native Worker worker query retains executable edge', 'src/lib/WorkerQuery.ts', 'export const worker = new Worker(new URL("../../visual/loader-outside/entry.ts?worker", import.meta.url))', 'resolvable-imports', 'outsideProduction'],
  ['native Worker alias retains declaration provenance', 'src/lib/WorkerAlias.ts', 'const Native = Worker; export const worker = new Native(new URL("../../visual/loader-outside/entry.ts", import.meta.url))', 'resolvable-imports', 'outsideProduction'],
  ['shadowed Worker class has no native loader capability', 'src/lib/FakeWorker.ts', 'class Worker { constructor(public url: URL) {} }; export const worker = new Worker(new URL("../../visual/loader-outside/entry.ts", import.meta.url))', null],
  ['pure URL construction is not a Worker edge', 'src/lib/PureUrl.ts', 'export const url = new URL("../../visual/loader-outside/entry.ts?raw&worker", import.meta.url)', null],
  ['glob query object is explicitly unsupported', 'src/lib/GlobQueryObject.ts', 'export const files = import.meta.glob("./loader-owned/*.ts", { query: { raw: true } })', 'resolvable-imports', 'unsupportedLoader'],
  ['glob contradictory as and query options are unsupported', 'src/lib/GlobContradictory.ts', 'export const files = import.meta.glob("../../visual/loader-outside/*.ts", { as: "raw", query: "?worker" })', 'resolvable-imports', 'unsupportedLoader'],
  ['legacy worker glob option is executable', 'src/lib/GlobAsWorker.ts', 'export const files = import.meta.glob("../../visual/loader-outside/*.ts", { as: "worker" })', 'resolvable-imports', 'outsideProduction'],
  ['glob braces use maintained matcher semantics', 'src/lib/GlobBraces.ts', 'export const files = import.meta.glob("./loader-owned/{entry,other}.ts")', null],
  ['native Worker rejects shadowed URL constructor', 'src/lib/WorkerFakeUrl.ts', 'class URL { constructor(public path: string, public base: string) {} }; export const worker = new Worker(new URL("./loader-owned/entry.ts", import.meta.url))', 'resolvable-imports', 'unsupportedLoader'],
  ['UI Worker cannot directly consume endpoint entry', 'src/hooks/WorkerEndpoint.ts', 'export const worker = new Worker(new URL("../services/api/records.ts", import.meta.url))', 'ui-service-boundary', 'endpoint'],
  ['native Worker unresolved target is explicit', 'src/lib/WorkerMissing.ts', 'export const worker = new Worker(new URL("./loader-owned/missing.ts", import.meta.url))', 'resolvable-imports', 'unresolved'],
  ['test-only glob retains reverse QA exemption', 'src/test/LoaderConsumer.test.ts', 'export const files = import.meta.glob("../../visual/loader-outside/*.ts", { eager: true })', null],
  ['native Worker missing owned js cannot borrow sibling ts', 'src/lib/WorkerOwnedMissingJs.ts', 'export const worker = new Worker(new URL("./loader-owned/entry.js", import.meta.url), { type: "module" })', 'resolvable-imports', 'unresolved'],
  ['native Worker existing JS with declarations remains owned', 'src/lib/WorkerOwnedPair.ts', 'export const worker = new Worker(new URL("./worker-paired/paired.js", import.meta.url), { type: "module" })', null],
  ['native Worker existing JS keeps runtime boundary despite declarations', 'src/lib/WorkerOutsidePair.ts', 'export const worker = new Worker(new URL("../../visual/bridge.js", import.meta.url), { type: "module" })', 'resolvable-imports', 'outsideProduction'],
  ['native Worker runtime symlink cannot hide behind local declaration', 'src/lib/WorkerSymlinkPair.ts', 'export const worker = new Worker(new URL("./worker-paired/linked.js", import.meta.url), { type: "module" })', 'resolvable-imports', 'outsideProduction'],
  ['feature barrel exported eager glob cannot expose endpoint map', 'src/features/glob-leak/index.ts', 'export const records = import.meta.glob<{ getRecord: () => Promise<unknown> }>("/src/services/api/records.ts", { eager: true })', 'ui-service-boundary', 'endpoint'],
  ['UI consumer leaves glob-map violation on producer', 'src/pages/GlobPublicConsumer.ts', 'import { records } from "@/features/glob-leak"; export const modules = records', null],
  ['feature barrel exported lazy glob cannot expose endpoint map', 'src/features/glob-lazy-leak/index.ts', 'export const records = import.meta.glob("/src/services/api/records.ts")', 'ui-service-boundary', 'endpoint'],
  ['feature barrel local named glob export keeps ownership', 'src/features/glob-local-leak/index.ts', 'const records = import.meta.glob("/src/services/api/records.ts", { eager: true }); export { records }', 'ui-service-boundary', 'endpoint'],
  ['feature barrel renamed const glob aliases keep ownership', 'src/features/glob-alias-leak/index.ts', 'const records = import.meta.glob("/src/services/api/records.ts", { eager: true }); const exposed = records; export { exposed as catalog }', 'ui-service-boundary', 'endpoint'],
  ['feature barrel direct default glob export keeps ownership', 'src/features/glob-default-leak/index.ts', 'export default import.meta.glob("/src/services/api/records.ts", { eager: true })', 'ui-service-boundary', 'endpoint'],
  ['feature barrel local default glob export keeps ownership', 'src/features/glob-local-default-leak/index.ts', 'const records = import.meta.glob("/src/services/api/records.ts", { eager: true }); const exposed = (records); export default exposed', 'ui-service-boundary', 'endpoint'],
  ['feature barrel shorthand object preserves glob export ownership', 'src/features/glob-object-leak/index.ts', 'const records = import.meta.glob("/src/services/api/records.ts", { eager: true }); export default { records }', 'ui-service-boundary', 'endpoint'],
  ['feature barrel array property preserves glob export ownership', 'src/features/glob-array-leak/index.ts', 'const records = import.meta.glob("/src/services/api/records.ts", { eager: true }); export const catalog = { maps: [records] }', 'ui-service-boundary', 'endpoint'],
  ['feature barrel object spread preserves glob export ownership', 'src/features/glob-spread-leak/index.ts', 'const records = import.meta.glob("/src/services/api/records.ts", { eager: true }); export default { ...records }', 'ui-service-boundary', 'endpoint'],
  ['feature barrel exported glob can select safe error helper', 'src/features/glob-safe-error/index.ts', 'export const errors = import.meta.glob("/src/services/apiClient.ts", { eager: true, import: "apiErrorMessage" })', null],
  ['feature barrel exported glob keeps transport selection forbidden', 'src/features/glob-transport-leak/index.ts', 'export const requests = import.meta.glob("/src/services/apiClient.ts", { eager: true, import: "requestJson" })', 'ui-service-boundary', 'transport'],
  ['feature barrel service facade glob is a legitimate public map', 'src/features/glob-service/index.ts', 'export const services = import.meta.glob("/src/services/recordService.ts", { eager: true })', null],
  ['feature barrel private glob consumed as count is not exported map', 'src/features/glob-private/index.ts', 'const records = import.meta.glob("/src/services/api/records.ts", { eager: true }); export const count = Object.keys(records).length', null],
  ['feature barrel type-only export does not publish runtime map', 'src/features/glob-type-only/index.ts', 'const records = import.meta.glob("/src/services/api/records.ts", { eager: true }); export type { records }; export const count = Object.keys(records).length', null],
  ['feature barrel own module glob remains a legitimate public map', 'src/features/glob-owned/index.ts', 'export const modules = import.meta.glob("./own.ts", { eager: true })', null],
  ['feature barrel Worker instance is not a module-map reexport', 'src/features/worker-instance/index.ts', 'export const worker = new Worker(new URL("../../services/api/records.ts", import.meta.url), { type: "module" })', null],
]

// Authored expectations, not a snapshot of lint output. Every message counts,
// including secondary rules and warnings; valid fixtures always expect [].
const diagnostic = (rule, messageId) => [rule.startsWith('@') || rule.includes('/')
  ? rule : `architecture/${rule}`, messageId]
const seam = (message = 'endpoint') => diagnostic('ui-service-boundary', message)
const role = (message) => diagnostic('ui-role-names', message)
const explicitAny = diagnostic('@typescript-eslint/no-explicit-any', 'unexpectedAny')
const defaults = {
  'feature-public-api': 'feature',
  'ui-service-boundary': 'endpoint',
  'no-production-test-imports': 'test',
  'resolvable-imports': 'unresolved',
  'ui-role-names': 'componentPlacement',
  '@typescript-eslint/no-unsafe-assignment': 'anyAssignment',
  '@typescript-eslint/no-unsafe-argument': 'unsafeArgument',
  '@typescript-eslint/no-unsafe-call': 'unsafeCall',
  '@typescript-eslint/no-unsafe-member-access': 'unsafeMemberExpression',
  '@typescript-eslint/no-unsafe-return': 'unsafeReturn',
}
const exactDiagnostics = new Map([
  ['namespace through barrel', [seam(), seam()]],
  ['default through barrel', [seam(), seam()]],
  ['renamed backend transport', [seam('transport'), seam('transport')]],
  ['namespace backend transport', [seam('transport')]],
  ['destructured backend namespace', [seam('transport')]],
  ['computed backend namespace', [seam('transport')]],
  ['production imports tests', [diagnostic('feature-public-api', 'feature'), diagnostic('no-production-test-imports', 'test')]],
  ['computed module import', [diagnostic('resolvable-imports', 'computed')]],
  ['unsafe service assignment', [explicitAny, diagnostic('@typescript-eslint/no-unsafe-assignment', 'anyAssignment')]],
  ['unsafe service argument', [explicitAny, diagnostic('@typescript-eslint/no-unsafe-argument', 'unsafeArgument')]],
  ['unsafe service call', [explicitAny, diagnostic('@typescript-eslint/no-unsafe-call', 'unsafeCall'), diagnostic('@typescript-eslint/no-unsafe-return', 'unsafeReturn')]],
  ['unsafe service member', [explicitAny, diagnostic('@typescript-eslint/no-unsafe-assignment', 'anyAssignment'), diagnostic('@typescript-eslint/no-unsafe-member-access', 'unsafeMemberExpression')]],
  ['unsafe service return', [explicitAny, diagnostic('@typescript-eslint/no-unsafe-return', 'unsafeReturn')]],
  ['JSX moved outside UI folders retains seam', [role('componentPlacement'), seam(), seam()]],
  ['renamed JSX component', [role('componentPlacement'), role('componentName')]],
  ['JSX extension bypass', [role('componentPlacement'), role('componentName')]],
  ['rendering page needs Page suffix', [role('pageName')]],
  ['aliased React hook renamed module', [role('hookPlacement'), role('hookName')]],
  ['namespaced hook relocated seam', [role('hookPlacement'), seam(), seam()]],
  ['wrong hook callable name', [role('hookPlacement'), role('hookName'), diagnostic('react-hooks/rules-of-hooks', undefined)]],
  ['React factory requires TSX component file', [role('componentPlacement'), role('componentName')]],
  ['React namespace factory relocated seam', [role('componentPlacement'), seam(), seam()]],
  ['React local factory alias', [role('componentPlacement'), role('componentName')]],
  ['typed null-render component renamed', [role('componentPlacement'), role('componentName')]],
  ['ambiguous null-render hook caller', [role('hookPlacement'), role('ambiguousRole')]],
  ['hook returning JSX is explicitly ambiguous', [role('ambiguousRole')]],
  ['opaque custom hook wrapper is diagnostic', [role('ambiguousRole'), diagnostic('feature-public-api', 'feature')]],
  ['React class component renamed', [role('componentPlacement'), role('componentName')]],
  ['registered default arrow renderer owns its source', [role('componentPlacement'), diagnostic('react-refresh/only-export-components', 'anonymousExport')]],
  ['bootstrap exemption is exact path', [role('componentPlacement'), role('componentName')]],
  ['root composition never exempts backend seam', [role('componentPlacement'), seam(), seam()]],
  ['computed React callable is explicit diagnostic', [role('ambiguousRole')]],
  ['Zustand moved hook still enforces filename', [role('hookPlacement'), role('hookName')]],
  ['Zustand moved hook still enforces callable name', [role('hookPlacement'), role('hookName')]],
  ['Zustand renamed callable still activates service seam', [role('hookPlacement'), seam(), seam()]],
  ['Zustand namespace still activates service seam', [role('hookPlacement'), seam(), seam()]],
  ['same-named local type cannot clear unknown hook diagnostic', [role('ambiguousRole')]],
  ['type-erased native fetch alias', [seam('escapedFetch'), seam('fetch')]],
  ['assertion-erased native fetch alias', [seam('escapedFetch'), seam('fetch')]],
  ['native method capability escape', [seam('escapedFetch'), seam('escapedFetch')]],
  ['registered renderer cannot hide backend imports', [role('componentPlacement'), seam(), seam()]],
  ['any picker remains an explicit opaque registration', [role('opaqueComponent'), explicitAny]],
])
for (const name of [
  'backend fetch', 'window backend fetch', 'protocol-relative API query cannot impersonate asset',
  'relative dot segments normalize before API classification', 'backslash URL normalizes before API classification',
  'encoded API pathname is not an asset', 'renamed pure helper cannot own backend fetch',
  'ordinary service cannot own backend fetch', 'endpoint mapper cannot bypass sole native fetch owner',
  'native fetch call backend', 'native fetch apply backend',
]) exactDiagnostics.set(name, [seam('fetch')])
for (const name of [
  'unclassifiable backend fetch', 'non-asset query suffix cannot impersonate asset',
  'dynamic apply arguments fail closed', 'pure helper dynamic native URL fails closed',
]) exactDiagnostics.set(name, [seam('unknownFetch')])
for (const name of [
  'native fetch bound capability', 'native fetch typed callback escape',
  'exported native fetch capability', 'type-erased destructuring capability fails closed',
]) exactDiagnostics.set(name, [seam('escapedFetch')])

let fixtureRoot
let root
let eslint
let resultsByFile
function write(relative, content) {
  const target = path.join(root, relative)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
}

beforeAll(async () => {
  // Fixtures must remain distinct on case-insensitive development filesystems.
  expect(new Set(cases.map(([, filename]) => filename.toLowerCase())).size).toBe(cases.length)
  fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'seeon-architecture-'))
  const physicalRoot = path.join(fixtureRoot, 'project')
  mkdirSync(physicalRoot)
  // Force configured and canonical project identities to differ on every host,
  // not only hosts whose temporary directory already has a system alias.
  root = path.join(fixtureRoot, 'project-link')
  symlinkSync(physicalRoot, root, 'dir')
  symlinkSync(path.resolve(process.cwd(), 'node_modules'), path.join(root, 'node_modules'), 'dir')
  write('tsconfig.json', JSON.stringify({
    compilerOptions: {
      target: 'ES2020', module: 'ESNext', moduleResolution: 'bundler',
      jsx: 'react-jsx', strict: true, allowJs: true, noEmit: true, resolveJsonModule: true,
      baseUrl: '.', paths: { '@/*': ['./src/*'], '@fake-asset.svg': ['./visual/ordinary.ts'] },
    },
    include: ['src/**/*', 'visual/**/*'],
  }))
  write('src/vite-env.d.ts', '/// <reference types="vite/client" />')
  write('src/features/glob-owned/own.ts', 'export const value = 1')
  write('src/lib/loader-owned/entry.ts', 'export const ready = true')
  write('src/lib/worker-paired/paired.js', 'export const ready = true')
  write('src/lib/worker-paired/paired.d.ts', 'export declare const ready: boolean')
  write('src/lib/worker-paired/linked.d.ts', 'export declare function bridge(): Promise<unknown>')
  write('src/test/loader-entry.test.ts', 'export const fixture = true')
  write('src/features/alpha/node_modules/fixture/loader-entry.ts', 'export const ready = true')
  write('visual/loader-outside/entry.ts', 'fetch("/api/v1/records")')
  write('visual/loader-hidden/.hidden.ts', 'fetch("/api/v1/records")')
  write('visual/sideEffect.ts', 'fetch("/api/v1/records")')
  write('visual/ordinary.ts', 'export function load() { return fetch("/api/v1/records") }')
  write('visual/transport.ts', 'import { requestJson } from "../src/services/apiClient"; export function request() { return requestJson("/records") }')
  write('visual/OutsidePanel.tsx', 'export function OutsidePanel() { return null }')
  write('visual/barrel.ts', 'export { load } from "./ordinary"')
  write('visual/contracts.ts', 'export interface OutsideModel { label: string }; export const value: OutsideModel = { label: "outside" }')
  write('visual/bridge.d.ts', 'export interface BridgeResult { id: string }; export declare function bridge(): Promise<BridgeResult>')
  write('visual/bridge.js', 'export function bridge() { return fetch("/api/v1/records") }')
  write('visual/settings.json', '{"enabled":true}')
  write('visual/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg" />')
  write('visual/theme.css', ':root { color: black; }')
  write('visual/outside.test.ts', 'export const fixture = 1')
  write('visual/test-barrel.ts', 'export { fixture } from "./outside.test"')
  write('build-tool.ts', 'export function build() { return "tooling" }')
  write('../external/helper.ts', 'export const external = 1; export interface ExternalModel { id: string }')
  write('src/features/alpha/internal.ts', 'export const internal = 1; export default internal; export type Value = number')
  write('src/features/alpha/public.ts', 'export { internal } from "./internal"')
  write('src/features/alpha/index.ts', 'export { internal } from "./internal"')
  write('src/features/alpha/internal.test.ts', 'export const fixture = 1')
  write('src/features/testLeak/index.ts', 'export { fixture } from "../alpha/internal.test"')
  write('src/features/screen/index.ts', 'export default function Screen() { return \"screen\" }')
  write('src/test/fixture.ts', 'export const fixture = 1')
  write('src/services/api/records.ts', 'export interface WireRecord { id: string }; export const getRecord = async (): Promise<WireRecord> => ({ id: "1" })')
  write('src/services/recordService.ts', 'import { getRecord } from "./api/records"; export const recordService = { getRecord }')
  write('src/types/alertMedia.ts', 'export interface ReadyAlertMediaClip { path: string }; export interface AlertMediaMetadata { clip: ReadyAlertMediaClip }; export type AlertMediaAccessAction = \"PLAY\"')
  write('src/lib/alertMediaErrors.ts', 'export class AlertMediaDownloadError extends Error {}; export type AlertMediaDownloadErrorCode = \"DENIED\"')
  write('src/services/alertService.ts', 'export type { ReadyAlertMediaClip, AlertMediaMetadata, AlertMediaAccessAction } from \"../types/alertMedia\"; export { AlertMediaDownloadError, type AlertMediaDownloadErrorCode } from \"../lib/alertMediaErrors\"')
  write('src/services/api/alertMedia.ts', 'export interface AlertMediaMetadata { storageKey: string }')
  write('src/features/fakeMedia/index.ts', 'export type { AlertMediaMetadata } from "@/services/api/alertMedia"')
  write('src/services/apiClient.ts', 'export const requestJson = async (url: string) => url; export const apiErrorMessage = () => "error"')
  write('src/types/index.ts', 'export interface UsefulDTO { label: string }')
  write('src/services/api/records/dto/record-response.dto.ts', 'export interface RecordResponseDto { id: string }')
  write('src/services/api/records/dto/record-request.dto.ts', 'export interface RecordRequestDto { id: string }')
  write('src/services/api/records/dto/alternate-request.dto.ts', 'export interface AlternateRequestDto { code: number }')
  write('src/lib/optionFactories.ts', [
    'import type { RecordRequestDto } from "@/services/api/records/dto/record-request.dto";',
    'import type { AlternateRequestDto } from "@/services/api/records/dto/alternate-request.dto";',
    'export function literalOptions(body: RecordRequestDto): RequestInit { return { method: "POST", body: JSON.stringify(body) } }',
    'export function signalOptions(request: { body: RecordRequestDto | AlternateRequestDto; signal?: AbortSignal }): RequestInit { const options: RequestInit = { method: "POST", body: JSON.stringify(request.body) }; if (request.signal !== undefined) options.signal = request.signal; return options }',
    'export function broadOptions(body: object): RequestInit { return { body: JSON.stringify(body) } }',
    'export function recordOptions(request: { body: Record<string, string | number> }): RequestInit { return { body: JSON.stringify(request.body) } }',
    'export declare const opaqueOptions: () => RequestInit;',
    'export function nestedOptions(body: RecordRequestDto): RequestInit { return literalOptions(body) }',
    'export function mutatedOptions(body: RecordRequestDto): RequestInit { const options: RequestInit = { body: JSON.stringify(body) }; options.body = JSON.stringify({ hidden: true }); return options }',
    'export function computedOptions(body: RecordRequestDto, key: "body"): RequestInit { const options: RequestInit = { body: JSON.stringify(body) }; options[key] = JSON.stringify({ hidden: true }); return options }',
    'export function aliasedOptions(body: RecordRequestDto): RequestInit { const options: RequestInit = { body: JSON.stringify(body) }; const alias = options; alias.body = "hidden"; return options }',
    'export function mixedOptions(request: { body: RecordRequestDto | Record<string, unknown> }): RequestInit { return { body: JSON.stringify(request.body) } }',
    'export function unionOptions(body: RecordRequestDto | AlternateRequestDto): RequestInit { return { body: JSON.stringify(body) } }',
    'export const sharedOptions: RequestInit = { method: "POST" };',
    'export const inlineJson = JSON.stringify({ id: "1" });',
    'export const canonicalJson = JSON.stringify({ id: "1" } satisfies RecordRequestDto);',
    'export let mutableJson = JSON.stringify({ id: "1" });',
    'export { inlineJson as reexportedInlineJson, canonicalJson as reexportedCanonicalJson, mutableJson as reexportedMutableJson };',
  ].join('\n'))
  write('src/services/api/records/dto/renamed-response.dto.ts', 'export interface RenamedRecord { id: string }')
  write('src/services/api/records/dto/misc.ts', 'export interface WrongFileDto { id: string }')
  write('src/types/movedWire.ts', 'export interface MovedResponseDto { id: string }')
  write('src/types/wireReexport.ts', 'type HiddenPayload = { id: string }; export type { HiddenPayload as Payload }')
  write('src/types/misusedView.ts', 'export interface MisusedView { id: string }')
  write('src/types/domainRecord.ts', 'export interface DomainRecord { id: string }')
  write('src/services/wireViewService.ts', 'import type { RecordResponseDto } from "./api/records/dto/record-response.dto"; import type { DomainRecord } from "@/types/domainRecord"; export type WireView = RecordResponseDto; export function wireResult(): RecordResponseDto { return { id: "1" } }; export const inferredWire = () => ({ id: "1" } as RecordResponseDto); export const asyncWire = async () => ({ id: "1" } as RecordResponseDto); export function workflow(): DomainRecord { return { id: "1" } }')
  write('src/types/wireAliases.ts', 'import type { RecordResponseDto } from "@/services/api/records/dto/record-response.dto"; import type * as wire from "@/services/api/records/dto/record-response.dto"; import type { wireResult, inferredWire, asyncWire, workflow } from "@/services/wireViewService"; export interface WireExtension extends RecordResponseDto { label: string }; export type WirePick = Pick<RecordResponseDto, "id">; export type WireNamespace = wire.RecordResponseDto; export type WireReturn = ReturnType<typeof wireResult>; export type WireInferredReturn = ReturnType<typeof inferredWire>; export type WireAsyncReturn = Awaited<ReturnType<typeof asyncWire>>; export type WorkflowView = ReturnType<typeof workflow>')
  write('src/features/leak/index.ts', 'export { getRecord as renamed } from "@/services/api/records"; export type { WireRecord } from "@/services/api/records"')
  write('src/features/defaultLeak/index.ts', 'import { getRecord } from "@/services/api/records"; export default { getRecord }')
  write('src/stores/countStore.ts', 'import { create } from "zustand"; export const useCountStore = create<{ count: number }>()(() => ({ count: 0 }))')
  write('src/components/RegistrationHost.tsx', [
    'import { NullRenderer as NullAlias } from "@/lib/NullRenderer";',
    'import * as renderers from "@/lib/StringRenderer";',
    'import DefaultAlias from "@/lib/DefaultRenderer";',
    'import { RegisteredBackend } from "@/lib/RegisteredBackend";',
    'import { RegisteredPanel } from "./RegisteredPanel";',
    'import { TextPanel } from "@/features/registered";',
    'import { RegisteredScreen } from "@/pages/RegisteredScreen";',
    'import { RegisteredPage } from "@/pages/RegisteredPage";',
    'import { OpaqueRenderer } from "@/lib/OpaqueRenderer";',
    'import { StrictMode } from "@/lib/foreignComponent";',
    'import type { RegistrationProps } from "@/lib/registrationProps";',
    'const LocalAlias = NullAlias;',
    'export function RegistrationHost(props: RegistrationProps) { return <StrictMode><LocalAlias /><renderers.StringRenderer /><DefaultAlias /><RegisteredBackend /><RegisteredPanel /><TextPanel /><RegisteredScreen /><RegisteredPage /><OpaqueRenderer /><span>{props.label}</span></StrictMode> }',
  ].join('\n'))
  write('src/components/FactoryRegistration.tsx', 'import { createElement as create } from "react"; import { FactoryRenderer as Target } from "@/lib/FactoryRenderer"; const element = create; export const FactoryRegistration = () => element(Target)')
  write('src/features/registered/index.ts', 'export { TextPanel } from "./components/TextPanel"')
  write('src/lib/fakeFactoryConsumer.ts', 'import { textValue } from "./fakeFactoryTarget"; function createElement(value: () => string) { return value() }; export const text = createElement(textValue)')
  write('src/lib/testOnlyNull.test.tsx', 'import { testOnlyNull as TestOnly } from "./testOnlyNull"; export const view = <TestOnly />')
  for (const [, filename, code] of cases) write(filename, code)
  symlinkSync(path.join(root, 'visual/ordinary.ts'), path.join(root, 'src/lib/linkedOutside.ts'))
  symlinkSync(path.join(root, 'visual/loader-outside'), path.join(root, 'src/lib/loader-linked'), 'dir')
  symlinkSync(path.join(root, 'visual/bridge.js'), path.join(root, 'src/lib/worker-paired/linked.js'))
  eslint = new ESLint({
    cwd: root,
    overrideConfigFile: configFile,
    overrideConfig: {
      languageOptions: {
        parserOptions: { project: path.join(root, 'tsconfig.json'), tsconfigRootDir: root },
      },
    },
  })
  const results = await eslint.lintFiles(cases.map(([, filename]) => path.join(root, filename)))
  resultsByFile = new Map(results.map((result) => [result.filePath, result]))
  // This project-backed setup took 4.7s in isolation but exceeded 30s under
  // full-suite contention; bound this hook only, without relaxing assertions.
}, 60_000)

afterAll(() => {
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true })
})

describe('architecture boundaries through the actual repository ESLint configuration', () => {
  it.each(cases)('%s', (name, filename, _code, expectedRule, expectedMessage) => {
    const result = resultsByFile.get(path.join(root, filename))
    expect(result).toBeDefined()
    const messages = result.messages
    expect(messages.filter((message) => message.fatal || message.ruleId === null)).toEqual([])
    const expected = expectedRule
      ? exactDiagnostics.get(name) ?? [diagnostic(expectedRule, expectedMessage ?? defaults[expectedRule])]
      : []
    for (const [rule, message] of expected) {
      if (message === undefined) expect(rule).toBe('react-hooks/rules-of-hooks')
    }
    const ordered = (items) => items.toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    expect(ordered(messages.map(({ ruleId, messageId }) => [ruleId, messageId]))).toEqual(ordered(expected))
    const resolvedTargets = {
      'local declaration and JS pair cannot hide runtime edge': 'visual/bridge.d.ts',
      'local explicit JS declaration pair cannot hide runtime edge': 'visual/bridge.d.ts',
      'fake asset alias spelling cannot hide resolved executable': 'visual/ordinary.ts',
      'real target of src symlink cannot escape enforcement': 'visual/ordinary.ts',
      'relative code outside worktree is still local executable': '../external/helper.ts',
      'lazy Vite glob cannot import outside executable': 'visual/loader-outside/entry.ts',
      'eager Vite glob cannot import outside executable': 'visual/loader-outside/entry.ts',
      'glob symlink uses real outside target': 'visual/loader-outside/entry.ts',
      'native Worker existing JS keeps runtime boundary despite declarations': 'visual/bridge.js',
      'native Worker runtime symlink cannot hide behind local declaration': 'visual/bridge.js',
    }
    if (resolvedTargets[name]) {
      expect(messages[0].message).toBe(
        `Production runtime imports must stay inside enforced src code or actual external libraries, not local executable ${resolvedTargets[name]}.`,
      )
    }
  })
})
