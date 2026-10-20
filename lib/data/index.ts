import "server-only";
import { createDemoData, type Data } from "./demo";
import { createNodePgDb } from "./node-pg";
import { createPgData } from "./pg";

/**
 * With DATABASE_URL set the app uses Postgres (Supabase); without it, the in-memory demo store.
 * Every function takes the tenant id explicitly and filters on it: this connection bypasses RLS, so tenant
 * isolation here is enforced in code, with RLS as the second layer for any direct client access.
 */
const g = globalThis as unknown as { __callsdashData?: Promise<Data> };
const backend = (): Promise<Data> =>
  (g.__callsdashData ??= process.env.DATABASE_URL ? Promise.resolve(createPgData(createNodePgDb(process.env.DATABASE_URL))) : createDemoData());

export const usingDatabase = () => Boolean(process.env.DATABASE_URL);

const call = <K extends keyof Data>(k: K) =>
  (async (...a: unknown[]) => ((await backend())[k] as (...x: unknown[]) => unknown)(...a)) as Data[K];

export const listTenants = call("listTenants");
export const getTenant = call("getTenant");
export const getProfile = call("getProfile");
export const getAgent = call("getAgent");
export const getAgentVersions = call("getAgentVersions");
export const getDoctors = call("getDoctors");
export const getBookings = call("getBookings");
export const getConversations = call("getConversations");
export const getConversation = call("getConversation");
export const getKnowledge = call("getKnowledge");
export const getUnanswered = call("getUnanswered");
export const getAlerts = call("getAlerts");
export const getAudit = call("getAudit");
export const getLedger = call("getLedger");
export const getTopUpRequests = call("getTopUpRequests");
export const getWallet = call("getWallet");
export const usageByChannel = call("usageByChannel");
export const audit = call("audit");
export const recordConversation = call("recordConversation");
export const topUp = call("topUp");
export const requestTopUp = call("requestTopUp");
export const renewTenantPackage = call("renewTenantPackage");
export const saveAgent = call("saveAgent");
export const rollbackAgent = call("rollbackAgent");
export const addKnowledge = call("addKnowledge");
export const deleteKnowledge = call("deleteKnowledge");
export const dismissUnanswered = call("dismissUnanswered");
export const setBookingStatus = call("setBookingStatus");
export const setPermissions = call("setPermissions");
export const updateTenant = call("updateTenant");
export const resolveAlert = call("resolveAlert");
export const createTenant = call("createTenant");
export const marginFor = call("marginFor");
export const creditsOwed = call("creditsOwed");
export const findTenantByAgent = call("findTenantByAgent");
export const createBooking = call("createBooking");
export const updateBooking = call("updateBooking");
export const addAlert = call("addAlert");
export const setDoctorCalendar = call("setDoctorCalendar");

export const getData = backend;
